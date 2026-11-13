import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createHostUploader } from '../create-host-uploader.ts';
import { dispatch } from '../dispatch.ts';
import type { EvidenceUploader } from '../evidence-uploader.ts';
import { runIDSchema } from '../run-events.ts';
import { createFakePullRequestHost } from '../test-utils/create-fake-pull-request-host.ts';
import type { FakePullRequestHost } from '../test-utils/create-fake-pull-request-host.ts';
import { createFileHostStandIn } from '../test-utils/create-file-host-stand-in.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import type { PullRequestHost, Wringer } from '../types.ts';

async function setupTest() {
  const token = 'planted-upload-token';
  const prURL = 'https://github.example/acme/shop/pull/7';
  const intro = 'Adds the express checkout.\n';

  const publishedSchema = z.looseObject({
    pr: z.strictObject({ number: z.number(), url: z.string() }),
    action: z.string(),
    uploaded: z.number(),
    reused: z.number(),
    local: z.number(),
    dryRun: z.boolean(),
    markdown: z.string().optional(),
    cuts: z.strictObject({
      droppedData: z.number(),
      collapsed: z.number(),
      shortCells: z.number(),
      omitted: z.number(),
    }),
  });

  const fileHost = createFileHostStandIn({ token });
  const env = { VERIFY_UPLOAD_URL: fileHost.url, VERIFY_UPLOAD_TOKEN: token };
  const base = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer: base, env });

  const buildWringer = (uploader: EvidenceUploader | undefined): Wringer => ({
    ...base,
    hooks: uploader === undefined ? {} : { upload: uploader },
    targets: new Map(
      [...base.targets].map(([name, target]) => [
        name,
        name === 'local' ? { ...target, evidence: 'upload' as const } : target,
      ]),
    ),
  });

  const defaultUploader = createHostUploader(
    { urlEnv: 'VERIFY_UPLOAD_URL', tokenEnv: 'VERIFY_UPLOAD_TOKEN' },
    { env, fetch },
  );

  const pullRequests = createFakePullRequestHost([
    {
      number: 7,
      url: prURL,
      body: intro,
      baseBranch: 'main',
      state: 'open',
      branch: 'main',
    },
    {
      number: 8,
      url: 'https://github.example/acme/shop/pull/8',
      body: '',
      baseBranch: 'main',
      state: 'closed',
      branch: 'old',
    },
  ]);

  const dispatchOn = (
    wringer: Wringer,
    path: readonly string[],
    args: unknown,
    options: { readonly pullRequests?: PullRequestHost; readonly timeoutMs?: number } = {},
  ) =>
    dispatch(wringer, path, args, {
      ...shop.session,
      pullRequests: options.pullRequests ?? pullRequests,
      timeoutMs: options.timeoutMs,
      target: 'local',
    });

  const uploading = buildWringer(defaultUploader);

  return {
    root: shop.repo.root,
    git: shop.repo.git,
    state: shop.state,
    fileHost,
    pullRequests,
    env,
    uploading,
    uploader: defaultUploader,
    buildWringer,
    shop,

    // Drives the checkout feature on the uploading `local` target and records its verdict.
    verifyCheckout: async (action: readonly string[], args: unknown = {}) => {
      await mkdir(join(shop.repo.root, 'src', 'checkout'), { recursive: true });
      await writeFile(join(shop.repo.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');
      await dispatchOn(uploading, ['up'], {});
      await dispatchOn(uploading, ['doctor'], {});
      await dispatchOn(uploading, ['use'], { feature: 'checkout' });
      await dispatchOn(uploading, ['action', ...action], args);
      await dispatchOn(uploading, ['done'], {});
    },
    publish: (args: unknown = {}, options?: Parameters<typeof dispatchOn>[3]) =>
      dispatchOn(uploading, ['publish'], args, options),
    publishWith: (
      wringer: Wringer,
      args: unknown = {},
      options?: Parameters<typeof dispatchOn>[3],
    ) => dispatchOn(wringer, ['publish'], args, options),
    readPublished: (data: unknown) => publishedSchema.parse(data),
    readBody: (host: FakePullRequestHost = pullRequests) => host.readStoredBody(7) ?? '',
    token,
    prURL,
    intro,
    readRunID: async () => {
      const [runID] = await shop.state.listRuns();

      return runIDSchema.parse(runID);
    },
  };
}

test('#publish writes the report with its evidence uploaded, and a second publish reuses every link', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const first = await ctx.publish();

  const bodyAfterFirst = ctx.readBody();

  const second = await ctx.publish();

  expect({
    first: { ok: first.envelope.ok, data: ctx.readPublished(first.envelope.data) },
    hasBlock:
      bodyAfterFirst.startsWith(ctx.intro) && bodyAfterFirst.includes('<!-- wringer:report -->'),
    image: bodyAfterFirst.includes(`<img src="https://${ctx.fileHost.host}/files/`),
    link: bodyAfterFirst.includes(`<a href="https://${ctx.fileHost.host}/files/`),
    second: ctx.readPublished(second.envelope.data),
    uploads: ctx.fileHost.uploads.length,
    unchanged: ctx.readBody() === bodyAfterFirst,
  }).toStrictEqual({
    first: {
      ok: true,
      data: {
        pr: { number: 7, url: ctx.prURL },
        action: 'created',
        uploaded: 2,
        reused: 0,
        local: 0,
        cuts: { droppedData: 0, collapsed: 0, shortCells: 0, omitted: 0 },
        dryRun: false,
      },
    },
    hasBlock: true,
    image: true,
    link: true,
    second: {
      pr: { number: 7, url: ctx.prURL },
      action: 'unchanged',
      uploaded: 0,
      reused: 2,
      local: 0,
      cuts: { droppedData: 0, collapsed: 0, shortCells: 0, omitted: 0 },
      dryRun: false,
    },
    uploads: 2,
    unchanged: true,
  });
});

test('#publish replaces an earlier block and keeps the text around it', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['receipt']);
  await ctx.publish();

  const edited = `${ctx.readBody()}\nA note from the author.\n`;

  await ctx.pullRequests.writeBody(7, edited);

  const again = await ctx.publish();

  expect({
    action: ctx.readPublished(again.envelope.data).action,
    keeps: ctx.readBody().endsWith('A note from the author.\n'),
    markers: ctx.readBody().split('<!-- wringer:report -->').length - 1,
  }).toStrictEqual({ action: 'unchanged', keeps: true, markers: 1 });
});

test('#publish leaves the description as it was when an upload fails', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const failing = createFileHostStandIn({ token: ctx.token, forceStatus: 500 });

  const uploader = createHostUploader(
    { urlEnv: 'VERIFY_UPLOAD_URL', tokenEnv: 'VERIFY_UPLOAD_TOKEN' },
    { env: { VERIFY_UPLOAD_URL: failing.url, VERIFY_UPLOAD_TOKEN: ctx.token }, fetch },
  );

  const result = await ctx.publishWith(ctx.buildWringer(uploader));

  expect({
    ok: result.envelope.ok,
    code: result.envelope.error?.code,
    body: ctx.readBody(),
    leaksToken: JSON.stringify(result.envelope).includes(ctx.token),
  }).toStrictEqual({ ok: false, code: 'environment', body: ctx.intro, leaksToken: false });
});

test('#publish keeps an edit made during the uploads', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const editing: EvidenceUploader = {
    ...ctx.uploading.hooks.upload,
    maxURLLength: 512,
    linkHosts: [ctx.fileHost.host],
    upload: async (file, signal) => {
      const body = ctx.readBody();

      if (!body.includes('Edited during the upload.')) {
        await ctx.pullRequests.writeBody(7, `${body}Edited during the upload.\n`);
      }

      const uploader = ctx.uploading.hooks.upload;

      if (uploader === undefined) {
        throw new Error('The test wringer has no upload hook.');
      }

      return uploader.upload(file, signal);
    },
  };

  const result = await ctx.publishWith(ctx.buildWringer(editing));

  expect({
    ok: result.envelope.ok,
    keepsEdit: ctx.readBody().includes('Edited during the upload.\n'),
    hasBlock: ctx.readBody().includes('<!-- /wringer:report -->'),
  }).toStrictEqual({ ok: true, keepsEdit: true, hasBlock: true });
});

test('#publish fails when another writer replaces the block after the write', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['receipt']);

  const overwriting: PullRequestHost = {
    ...ctx.pullRequests,
    writeBody: async (number, body) => {
      await ctx.pullRequests.writeBody(number, body);

      await ctx.pullRequests.writeBody(
        number,
        `${ctx.intro}\n<!-- wringer:report -->\nAnother tool wrote this.\n<!-- /wringer:report -->\n`,
      );
    },
  };

  const result = await ctx.publish({}, { pullRequests: overwriting });

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
    hint: result.envelope.error?.hint,
    stands: ctx.readBody().includes('Another tool wrote this.'),
  }).toStrictEqual({
    code: 'check-failed',
    message:
      'The report block is gone from the pull request description: another writer replaced it after the write, and that span stands.',
    hint: 'Run `publish` again.',
    stands: true,
  });
});

test('#publish runs on the read-only target with no run', async () => {
  const ctx = await setupTest();

  const result = await dispatch(
    ctx.uploading,
    ['publish'],
    {},
    { ...ctx.shop.session, pullRequests: ctx.pullRequests, target: 'prod' },
  );

  expect({
    ok: result.envelope.ok,
    action: result.envelope.ok ? ctx.readPublished(result.envelope.data).action : null,
    runs: await ctx.state.listRuns(),
  }).toStrictEqual({ ok: true, action: 'created', runs: [] });
});

test('#publish with --dry-run uploads nothing, writes nothing and counts the files it would upload', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const result = await ctx.publishWith(
    ctx.uploading,
    { dryRun: true },
    { pullRequests: ctx.pullRequests },
  );

  const data = ctx.readPublished(result.envelope.data);

  expect({
    uploaded: data.uploaded,
    local: data.local,
    dryRun: data.dryRun,
    markdown: data.markdown?.includes('the report was built with <code>--no-upload</code>'),
    uploads: ctx.fileHost.uploads.length,
    body: ctx.readBody(),
  }).toStrictEqual({
    uploaded: 2,
    local: 0,
    dryRun: true,
    markdown: true,
    uploads: 0,
    body: ctx.intro,
  });
});

test('#publish with --dry-run needs no upload variable', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const bare = createHostUploader(
    { urlEnv: 'VERIFY_UPLOAD_URL', tokenEnv: 'VERIFY_UPLOAD_TOKEN' },
    { env: {}, fetch },
  );

  const result = await ctx.publishWith(ctx.buildWringer(bare), { dryRun: true });

  expect(result.envelope.ok).toBe(true);
});

test('#publish with --no-upload keeps every journey local and uploads nothing', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const result = await ctx.publish({ upload: false });

  expect({
    data: ctx.readPublished(result.envelope.data),
    note: ctx.readBody().includes('the report was built with <code>--no-upload</code>'),
    uploads: ctx.fileHost.uploads.length,
  }).toStrictEqual({
    data: expect.objectContaining({ uploaded: 0, reused: 0, local: 2, action: 'created' }),
    note: true,
    uploads: 0,
  });
});

test('#publish fails with usage before it reads the PR when a target uploads and the registry has no hook', async () => {
  const ctx = await setupTest();

  const reads: string[] = [];

  const watching: PullRequestHost = {
    findOpen: (request) => {
      reads.push('findOpen');

      return ctx.pullRequests.findOpen(request);
    },
    readBody: (number) => ctx.pullRequests.readBody(number),
    writeBody: (number, body) => ctx.pullRequests.writeBody(number, body),
  };

  const result = await ctx.publishWith(ctx.buildWringer(undefined), {}, { pullRequests: watching });

  expect({ code: result.envelope.error?.code, reads }).toStrictEqual({ code: 'usage', reads: [] });
});

test('#publish fails with environment, naming the variable, before any upload when the URL is missing', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const unset = createHostUploader(
    { urlEnv: 'VERIFY_UPLOAD_URL', tokenEnv: 'VERIFY_UPLOAD_TOKEN' },
    { env: { VERIFY_UPLOAD_TOKEN: ctx.token }, fetch },
  );

  const result = await ctx.publishWith(ctx.buildWringer(unset));

  expect({
    code: result.envelope.error?.code,
    names: result.envelope.error?.message.includes('VERIFY_UPLOAD_URL'),
    leaksToken: JSON.stringify(result.envelope).includes(ctx.token),
    uploads: ctx.fileHost.uploads.length,
    body: ctx.readBody(),
  }).toStrictEqual({
    code: 'environment',
    names: true,
    leaksToken: false,
    uploads: 0,
    body: ctx.intro,
  });
});

test('#publish fails with environment, and says to open the PR, when the branch has none', async () => {
  const ctx = await setupTest();

  await ctx.git('checkout', '--quiet', '-b', 'feature-without-pr');

  const result = await ctx.publish();

  expect({
    code: result.envelope.error?.code,
    hint: result.envelope.error?.hint,
  }).toStrictEqual({
    code: 'environment',
    hint: 'Open the pull request, or pass `--pr <number>`.',
  });
});

test('#publish lists the open PRs of a branch that has several', async () => {
  const ctx = await setupTest();

  const several: PullRequestHost = {
    ...ctx.pullRequests,
    findOpen: () => Promise.resolve({ kind: 'many', numbers: [7, 9] }),
  };

  const result = await ctx.publish({}, { pullRequests: several });

  expect(result.envelope.error?.message).toBe(
    'The current branch has several open pull requests: 7, 9.',
  );
});

test('#publish needs --pr on a detached HEAD', async () => {
  const ctx = await setupTest();

  await ctx.git('checkout', '--quiet', '--detach');

  const refused = await ctx.publish();
  const named = await ctx.publish({ pr: 7 });

  expect({
    refused: [refused.envelope.error?.code, refused.envelope.error?.hint],
    named: named.envelope.ok,
  }).toStrictEqual({ refused: ['environment', 'Pass `--pr <number>`.'], named: true });
});

test('#publish refuses a PR that is closed when --pr names it', async () => {
  const ctx = await setupTest();
  const result = await ctx.publish({ pr: 8 });

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    code: 'environment',
    message: 'Pull request 8 is closed.',
  });
});

test('#publish keeps a file the guard refuses local and uploads the rest', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const runID = await ctx.readRunID();

  const features = join(ctx.root, '.wringer', 'runs', runID, 'features');

  const [feature] = await readdir(features);

  const folder = join(features, feature ?? '');

  const names = await readdir(folder);

  const png = names.find((name) => name.endsWith('cart.png'));

  await writeFile(join(folder, png ?? ''), 'changed after done');

  const result = await ctx.publish();

  expect({
    data: ctx.readPublished(result.envelope.data),
    uploads: ctx.fileHost.uploads.map((upload) => upload.text),
    image: ctx.readBody().includes('<img'),
    local: /cart\.png \(\d+ B\)/u.test(ctx.readBody()),
  }).toStrictEqual({
    data: expect.objectContaining({ uploaded: 1, local: 1 }),
    uploads: ['paid 12 for the cart'],
    image: false,
    local: true,
  });
});

test('#publish refuses to write a description whose author text holds a known secret', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);
  await ctx.pullRequests.writeBody(7, 'Adds checkout. The key is planted-shop-token.\n');

  const result = await dispatch(
    ctx.uploading,
    ['publish'],
    {},
    {
      ...ctx.shop.session,
      env: { ...ctx.env, SHOP_API_TOKEN: 'planted-shop-token' },
      pullRequests: ctx.pullRequests,
      target: 'local',
    },
  );

  expect({
    code: result.envelope.error?.code,
    leaksEnvelope: JSON.stringify(result.envelope).includes('planted-shop-token'),
    body: ctx.readBody(),
  }).toStrictEqual({
    code: 'check-failed',
    leaksEnvelope: false,
    body: 'Adds checkout. The key is planted-shop-token.\n',
  });
});

test('#publish plans around a file that changes after the document guard and before the upload guard', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['album']);

  const runID = await ctx.readRunID();

  const features = join(ctx.root, '.wringer', 'runs', runID, 'features');

  const [feature] = await readdir(features);

  const folder = join(features, feature ?? '');

  const names = await readdir(folder);

  const png = names.find((name) => name.endsWith('cart.png'));
  const filler = `${'x'.repeat(61_600)}\n`;

  await ctx.pullRequests.writeBody(7, filler);

  let readyCalls = 0;

  const changing: EvidenceUploader = {
    ...ctx.uploader,
    assertReady: () => {
      readyCalls += 1;

      if (readyCalls === 2) {
        writeFileSync(join(folder, png ?? ''), 'changed it!');
      }
    },
  };

  const midFlight = await ctx.publishWith(ctx.buildWringer(changing));

  const midFlightBody = ctx.readBody();

  await ctx.pullRequests.writeBody(7, filler);

  const upFront = await ctx.publish();

  expect({
    midFlight: ctx.readPublished(midFlight.envelope.data).cuts,
    body: midFlightBody,
  }).toStrictEqual({
    midFlight: ctx.readPublished(upFront.envelope.data).cuts,
    body: ctx.readBody(),
  });
});

test('#publish fails before the first upload when a file holds a secret the scrubber missed', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['echo'], { text: 'the key is planted-shop-token' });

  const result = await dispatch(
    ctx.uploading,
    ['publish'],
    {},
    {
      ...ctx.shop.session,
      env: { ...ctx.env, SHOP_API_TOKEN: 'planted-shop-token' },
      pullRequests: ctx.pullRequests,
      target: 'local',
    },
  );

  expect({
    code: result.envelope.error?.code,
    leaks: JSON.stringify(result.envelope).includes('planted-shop-token'),
    uploads: ctx.fileHost.uploads.length,
    body: ctx.readBody(),
  }).toStrictEqual({ code: 'internal', leaks: false, uploads: 0, body: ctx.intro });
});

test('#publish keeps a secret that a run collected after its data was written out of the description', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['say'], { text: 'session planted-session-id' });

  const runID = await ctx.readRunID();

  await ctx.state.appendSecret(runID, {
    name: 'session',
    value: 'planted-session-id',
  });

  const linesBefore = ctx.shop.lines.length;

  const result = await ctx.publish();

  expect({
    ok: result.envelope.ok,
    leaksBody: ctx.readBody().includes('planted-session-id'),
    leaksEnvelope: JSON.stringify(result.envelope).includes('planted-session-id'),
    placeholder: ctx.readBody().includes('[redacted:session]'),
    leaksLines: ctx.shop.lines.slice(linesBefore).join('\n').includes('planted-session-id'),
  }).toStrictEqual({
    ok: true,
    leaksBody: false,
    leaksEnvelope: false,
    placeholder: true,
    leaksLines: false,
  });
});

test('#publish never writes the upload token to the description, a log line or the envelope', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const result = await ctx.publish();
  const runID = await ctx.readRunID();
  const log = await readFile(join(ctx.root, '.wringer', 'runs', runID, 'log.ndjson'), 'utf8');

  expect({
    body: ctx.readBody().includes(ctx.token),
    envelope: JSON.stringify(result.envelope).includes(ctx.token),
    lines: ctx.shop.lines.join('\n').includes(ctx.token),
    log: log.includes(ctx.token),
  }).toStrictEqual({ body: false, envelope: false, lines: false, log: false });
});

test('#publish fails with the room it lacks when the description leaves too little', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['receipt']);
  await ctx.pullRequests.writeBody(7, `${'x'.repeat(65_000)}\n`);

  const result = await ctx.publish();

  expect({
    code: result.envelope.error?.code,
    message:
      /^The report needs [\d,]+ characters, and the PR description has room for [\d,]+ of GitHub's 65,536\.$/u.test(
        result.envelope.error?.message ?? '',
      ),
    body: ctx.readBody().length,
  }).toStrictEqual({ code: 'check-failed', message: true, body: 65_001 });
});

test('#publish cuts the report to fit a description with little room and stays within the limit', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);
  await ctx.pullRequests.writeBody(7, `${'x'.repeat(60_000)}\n`);

  const result = await ctx.publish();

  expect({
    ok: result.envelope.ok,
    within: ctx.readBody().length <= 65_536,
  }).toStrictEqual({ ok: true, within: true });
});

test('#publish keeps a CRLF description within the limit', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);
  await ctx.pullRequests.writeBody(7, 'line\r\n'.repeat(9000));

  const result = await ctx.publish();

  expect({
    ok: result.envelope.ok,
    within: ctx.readBody().length <= 65_536,
    crlf: ctx.readBody().includes('<!-- wringer:report -->\r\n'),
  }).toStrictEqual({ ok: true, within: true, crlf: true });
});

test('#publish writes nothing when its deadline passes during the uploads', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout(['photo']);

  const release = Promise.withResolvers<undefined>();

  const slow: EvidenceUploader = {
    maxURLLength: 512,
    linkHosts: [ctx.fileHost.host],
    upload: async (file) => {
      await release.promise;

      return { url: `https://${ctx.fileHost.host}/files/${file.filename}`, expiresAt: null };
    },
  };

  const result = await ctx.publishWith(ctx.buildWringer(slow), {}, { timeoutMs: 100 });

  release.resolve(undefined);

  await result.late;

  expect({ code: result.envelope.error?.code, body: ctx.readBody() }).toStrictEqual({
    code: 'timeout',
    body: ctx.intro,
  });
});

test('#publish takes the PR from --pr, whatever branch is checked out', async () => {
  const ctx = await setupTest();

  await ctx.git('checkout', '--quiet', '-b', 'elsewhere');

  const result = await ctx.publish({ pr: 7 });

  expect({
    ok: result.envelope.ok,
    pr: ctx.readPublished(result.envelope.data).pr.number,
  }).toStrictEqual({ ok: true, pr: 7 });
});
