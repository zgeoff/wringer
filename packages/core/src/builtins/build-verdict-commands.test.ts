import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StatePort } from '../create-file-state.ts';
import { dispatch } from '../dispatch.ts';
import { readVerdicts } from '../read-verdicts.ts';
import { reportSchema } from '../report-schema.ts';
import { runIDSchema } from '../run-events.ts';
import type { RunEvent } from '../run-events.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import type { UploadRequest } from '../types.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  const reportDataSchema = z.strictObject({ report: reportSchema, markdown: z.string() });
  const uploads: UploadRequest[] = [];

  const uploading = {
    ...wringer,
    hooks: {
      upload: (file: UploadRequest) => {
        uploads.push(file);

        return Promise.resolve('https://files.example/receipt');
      },
    },
  };

  // `done` pauses where it hands its envelope to the state, before the state takes the run lock,
  // until the test releases it.
  const writing = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const pausedState: StatePort = {
    ...shop.state,
    appendEventUnless: async (runID, event, refuse) => {
      writing.resolve(undefined);

      await release.promise;

      return shop.state.appendEventUnless(runID, event, refuse);
    },
  };

  const run = (path: readonly string[], args: unknown = {}) =>
    dispatch(wringer, path, args, { ...shop.session, target: 'local' });

  return {
    root: shop.repo.root,
    git: shop.repo.git,

    // Drives the checkout feature with one action, then records its verdict.
    verifyCheckout: async (action: string) => {
      await mkdir(join(shop.repo.root, 'src', 'checkout'), { recursive: true });
      await writeFile(join(shop.repo.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');
      await run(['up']);
      await run(['doctor']);
      await run(['use'], { feature: 'checkout' });
      await run(['action', action]);
      await run(['done']);
    },
    uploads,
    run: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local' }),
    runPausedDone: () =>
      dispatch(wringer, ['done'], {}, { ...shop.session, state: pausedState, target: 'local' }),
    writing: writing.promise,
    releaseDone: () => {
      release.resolve(undefined);
    },
    appendEvent: (runID: string, event: RunEvent) => shop.state.appendEvent(runID, event),
    readVerdicts: () => readVerdicts(shop.state, shop.session.repoHost, shop.repo.root),
    runWithUpload: (path: readonly string[], env: Readonly<Record<string, string>> = {}) =>
      dispatch(uploading, path, {}, { ...shop.session, env, target: 'local' }),
    parseReportData: (data: unknown) => reportDataSchema.parse(data),

    // The body sits in the ignored state folder, as CI keeps it outside the checkout, so writing it
    // leaves the fingerprint alone.
    writeBody: async (markdown: string) => {
      await mkdir(join(shop.repo.root, '.wringer'), { recursive: true });

      await writeFile(
        join(shop.repo.root, '.wringer', 'body.md'),
        `Adds the express checkout.\n\n${markdown}`,
      );
    },
  };
}

test('#done refuses a feature with no passing drive since the doctor', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);

  const result = await ctx.run(['done'], { feature: 'checkout' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
  });
});

test('#done refuses a run whose doctor has not passed, with exit code 3', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);

  const result = await ctx.run(['done'], { feature: 'checkout' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('#done records a verdict with the evidence of the drives since the doctor', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  const result = await ctx.run(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: 'empty',
    run: result.envelope.instance,
    at: expect.any(String),
    evidence: [
      {
        kind: 'note',
        path: expect.stringMatching(/receipt\.txt$/u),
        sha256: expect.any(String),
        scrub: 'text',
      },
    ],
  });
});

test('#done refuses and records no verdict when a doctor fails while it waits for the run lock', async () => {
  const ctx = await setupTest();
  const up = await ctx.run(['up']);

  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  const runID = runIDSchema.parse(up.envelope.instance);
  const done = ctx.runPausedDone();

  onTestFinished(async () => {
    ctx.releaseDone();

    await Promise.allSettled([done]);
  });

  await ctx.writing;

  await ctx.appendEvent(runID, {
    type: 'doctor-failed',
    at: '2026-11-05T09:00:00.000Z',
    results: [],
  });

  ctx.releaseDone();

  const result = await done;
  const verdicts = await ctx.readVerdicts();

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    verdicts: [...verdicts.keys()],
  }).toStrictEqual({ exitCode: 3, code: 'doctor-required', verdicts: [] });
});

test('#report gives each changed feature its status and embeds the report block', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data).report;

  expect(data.features.map((feature) => [feature.name, feature.status])).toStrictEqual([
    ['checkout', 'verified'],
    ['search', 'unchanged'],
  ]);
});

test('#report uploads the evidence of a verified feature by its absolute path', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);
  await ctx.run(['done']);
  await ctx.runWithUpload(['report']);

  expect(ctx.uploads).toStrictEqual([
    {
      kind: 'note',
      path: expect.stringMatching(
        new RegExp(`^${ctx.root}/\\.wringer/runs/.+-receipt\\.txt$`, 'u'),
      ),
      sha256: expect.any(String),
      scrub: 'text',
    },
  ]);
});

test('#report links each uploaded evidence file to the URL the hook returns', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);
  await ctx.run(['done']);

  const result = await ctx.runWithUpload(['report']);

  const checkout = ctx
    .parseReportData(result.envelope.data)
    .report.features.find((feature) => feature.name === 'checkout');

  expect(checkout?.verdict?.evidence).toStrictEqual([
    {
      kind: 'note',
      path: expect.stringMatching(/^\.wringer\/runs\/.+-receipt\.txt$/u),
      sha256: expect.any(String),
      scrub: 'text',
      url: 'https://files.example/receipt',
    },
  ]);
});

test('#gate passes a PR body whose report holds a verdict at the current fingerprint', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const report = await ctx.run(['report']);

  const markdown = ctx.parseReportData(report.envelope.data).markdown;

  await ctx.writeBody(markdown);

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [] },
  });
});

test('#gate passes a PR into another branch when done took the same base', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });

  await ctx.git('checkout', '--quiet', '-b', 'release');

  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'add pay');
  await ctx.git('checkout', '--quiet', '-b', 'express');

  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 2;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done'], { base: 'release' });

  const report = await ctx.run(['report'], { base: 'release' });

  await ctx.writeBody(ctx.parseReportData(report.envelope.data).markdown);

  const result = await ctx.run(['gate'], { base: 'release', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [] },
  });
});

test('#gate fails a PR body whose verdict predates a change to the feature', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const report = await ctx.run(['report']);

  const markdown = ctx.parseReportData(report.envelope.data).markdown;

  await ctx.writeBody(markdown);

  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 2;\n');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    data: result.envelope.data,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    data: {
      fingerprint: expect.any(String),
      failing: [
        { name: 'checkout', reason: expect.stringMatching(/^verdict at \S+, tree at \S+$/u) },
      ],
      unmapped: [],
    },
  });
});

test('#gate fails a PR body with no report block for a changed feature', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'search'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'search', 'rank.ts'), 'export const rank = 1;\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect(result.envelope.data).toStrictEqual({
    fingerprint: expect.any(String),
    failing: [{ name: 'search', reason: 'The PR body holds no wringer report block.' }],
    unmapped: [],
  });
});

test('#gate keeps a verdict fresh after an edit to a README the repo ignores', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const report = await ctx.run(['report']);

  await ctx.writeBody(ctx.parseReportData(report.envelope.data).markdown);

  await writeFile(join(ctx.root, 'README.md'), '# shop\n\nPay with one click.\n');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [] },
  });
});

test('#gate fails a PR that changes a path no feature maps and the repo does not ignore', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'scripts'));
  await writeFile(join(ctx.root, 'scripts', 'seed.ts'), 'export const seed = 1;\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    hint: result.envelope.error?.hint,
    data: result.envelope.data,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    hint: expect.stringContaining('ignore list'),
    data: { fingerprint: expect.any(String), failing: [], unmapped: ['scripts/seed.ts'] },
  });
});

test('#gate passes a PR that changes only a path the repo ignores', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'docs'));
  await writeFile(join(ctx.root, 'docs', 'pay.md'), 'Pay with one click.\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [] },
  });
});

test('#gate passes a PR that changes only a path the repo shares', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'package.json'), '{}\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [] },
  });
});

test('#gate leaves an ignored path out of the unmapped paths when it became a folder', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'docs'));
  await writeFile(join(ctx.root, 'docs', 'guide.md'), 'guide\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'add guide');
  await ctx.git('rm', '--quiet', 'docs/guide.md');

  await mkdir(join(ctx.root, 'docs', 'guide.md'), { recursive: true });
  await writeFile(join(ctx.root, 'docs', 'guide.md', 'app.ts'), 'export const app = 1;\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'HEAD', bodyFile: '.wringer/body.md' });

  expect(result.envelope.data).toStrictEqual({
    fingerprint: expect.any(String),
    failing: [],
    unmapped: ['docs/guide.md/app.ts'],
  });
});

test('#report leaves a changed path the repo shares out of the unmapped paths', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'package.json'), '{}\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data);

  expect({ complete: data.report.complete, unmapped: data.report.unmapped }).toStrictEqual({
    complete: true,
    unmapped: [],
  });
});

test('#report lists each changed path that no feature maps', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'scripts'));
  await writeFile(join(ctx.root, 'scripts', 'seed.ts'), 'export const seed = 1;\n');
  await writeFile(join(ctx.root, 'README.md'), '# shop, edited\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data);

  expect({
    complete: data.report.complete,
    unmapped: data.report.unmapped,
    markdown: data.markdown,
  }).toStrictEqual({
    complete: false,
    unmapped: ['scripts/seed.ts'],
    markdown: expect.stringContaining('`scripts/seed.ts`'),
  });
});

test('#done records a verdict when a path the repo ignores changed after the run started', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  await writeFile(join(ctx.root, 'README.md'), '# shop, edited\n');

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 0,
    error: null,
  });
});

test('#done records a verdict when a path the repo ignores changed before the run started', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'README.md'), '# shop, edited\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 0,
    error: null,
  });
});

test('#action runs when a path the repo ignores changed after the doctor passed', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });

  await writeFile(join(ctx.root, 'README.md'), '# shop, edited\n');

  const result = await ctx.run(['action', 'receipt']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 0,
    error: null,
  });
});

test('#report keeps an opaque file local and never passes it to the upload hook', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout('photo');

  const result = await ctx.runWithUpload(['report']);

  const checkout = ctx
    .parseReportData(result.envelope.data)
    .report.features.find((feature) => feature.name === 'checkout');

  expect({
    uploaded: ctx.uploads.map((file) => file.kind),
    urls: checkout?.verdict?.evidence.map((item) => [item.kind, item.url]),
  }).toStrictEqual({
    uploaded: ['note'],
    urls: [
      ['note', 'https://files.example/receipt'],
      ['screenshot', undefined],
    ],
  });
});

test('#report keeps a file changed after it was recorded local', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout('receipt');

  const [verdict] = await ctx.readVerdicts().then((verdicts) => [...verdicts.values()]);

  await writeFile(join(ctx.root, verdict?.evidence[0]?.path ?? ''), 'swapped after the fact');

  const result = await ctx.runWithUpload(['report']);

  expect({ ok: result.envelope.ok, uploads: ctx.uploads }).toStrictEqual({ ok: true, uploads: [] });
});

test('#report fails with an internal error before it sends any file when one holds a known secret', async () => {
  const ctx = await setupTest();

  await ctx.verifyCheckout('photo');

  const result = await ctx.runWithUpload(['report'], { SHOP_API_TOKEN: 'for the cart' });

  expect({
    code: result.envelope.error?.code,
    exitCode: result.exitCode,
    uploads: ctx.uploads,
  }).toStrictEqual({ code: 'internal', exitCode: 4, uploads: [] });
});
