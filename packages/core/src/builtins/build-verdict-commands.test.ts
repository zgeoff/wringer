import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StatePort } from '../create-file-state.ts';
import { dispatch } from '../dispatch.ts';
import type { UploadFile } from '../evidence-uploader.ts';
import { readVerdicts } from '../read-verdicts.ts';
import { parseReportComment } from '../report-comment.ts';
import { reportSchema } from '../report-schema.ts';
import type { ReportComment } from '../report-schema.ts';
import { runIDSchema } from '../run-events.ts';
import type { RunEvent, RunID } from '../run-events.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';

async function setupTest() {
  const wringer = createShopWringer();
  const refusing = createShopWringer({ gate: { unpinned: 'refuse' } });

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  const failureSchema = z.object({ name: z.string(), status: z.string() });
  const failingSchema = z.looseObject({ failing: z.array(failureSchema) });
  const reportDataSchema = z.strictObject({ report: reportSchema, markdown: z.string() });
  const uploads: UploadFile[] = [];

  const uploading = {
    ...wringer,
    hooks: {
      upload: {
        maxURLLength: 512,
        linkHosts: ['files.example'],
        upload: (file: UploadFile) => {
          uploads.push(file);

          return Promise.resolve({ url: 'https://files.example/receipt', expiresAt: null });
        },
      },
    },
  };

  const uploadingTarget = {
    ...uploading,
    targets: new Map(
      [...wringer.targets].map(([name, target]) => [
        name,
        name === 'local' ? { ...target, evidence: 'upload' as const } : target,
      ]),
    ),
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

      const up = await run(['up']);

      await run(['doctor']);
      await run(['use'], { feature: 'checkout' });
      await run(['action', action]);
      await run(['done']);

      return up.envelope.instance ?? '';
    },
    keepSecret: (runID: string, name: string, value: string) =>
      shop.state.appendSecret(runID, { name, value }),
    uploads,
    run: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local' }),
    runOn: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),

    runRefusing: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(refusing, path, args, { ...shop.session, target }),

    // Changes a checkout file, verifies the feature on the attach target `prod` and returns the
    // report Markdown.
    publishCheckout: async (): Promise<string> => {
      await mkdir(join(shop.repo.root, 'src', 'checkout'), { recursive: true });
      await writeFile(join(shop.repo.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

      const dispatchOn = (path: readonly string[], args: unknown = {}) =>
        dispatch(wringer, path, args, { ...shop.session, target: 'prod' });

      await dispatchOn(['attach']);
      await dispatchOn(['doctor']);
      await dispatchOn(['use'], { feature: 'checkout' });
      await dispatchOn(['action', 'count']);
      await dispatchOn(['done']);

      const report = await dispatchOn(['report']);

      return reportDataSchema.parse(report.envelope.data).markdown;
    },
    readFailing: (data: unknown) => failingSchema.parse(data).failing,

    // The Markdown with its data comment replaced by the edited comment.
    rewriteComment: (markdown: string, edit: (comment: ReportComment) => unknown): string => {
      const read = parseReportComment(markdown);

      if (!read.ok) {
        throw new Error(read.message);
      }

      const start = markdown.indexOf('<!-- wringer-data v2 ');
      const end = markdown.indexOf(' -->', start) + ' -->'.length;
      const edited = JSON.stringify(edit(read.comment));

      return `${markdown.slice(0, start)}<!-- wringer-data v2 ${edited} -->${markdown.slice(end)}`;
    },
    runPausedDone: () =>
      dispatch(wringer, ['done'], {}, { ...shop.session, state: pausedState, target: 'local' }),
    writing: writing.promise,
    releaseDone: () => {
      release.resolve(undefined);
    },
    appendEvent: (runID: string, event: RunEvent) => shop.state.appendEvent(runID, event),
    readEvents: (runID: RunID) => shop.state.readRunEvents(runID),

    // Rewrites the current run's log as a run that wrote no `scopes-read`.
    dropScopes: async () => {
      const [runID] = await shop.state.listRuns();

      const log = join(shop.repo.root, '.wringer', 'runs', String(runID), 'log.ndjson');

      const text = await readFile(log, 'utf8');

      await writeFile(
        log,
        text
          .split('\n')
          .filter((line) => !line.includes('"scopes-read"'))
          .join('\n'),
      );
    },
    readVerdicts: () => readVerdicts(shop.state, shop.session.repoHost, shop.repo.root),
    runWithUpload: (path: readonly string[], env: Readonly<Record<string, string>> = {}) =>
      dispatch(uploading, path, {}, { ...shop.session, env, target: 'local' }),
    runOnUploadingTarget: (path: readonly string[], args: unknown = {}) =>
      dispatch(uploadingTarget, path, args, { ...shop.session, target: 'local' }),
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

test.each([
  [
    'one version 2 comment that parses',
    (markdown: string) => markdown,
    { exitCode: 0, message: undefined, hint: undefined, failing: [] },
  ],
  [
    'no data comment and no version 1 block',
    () => 'No report here.',
    {
      exitCode: 1,
      message: expect.stringContaining('checkout'),
      hint: expect.stringContaining('update the PR body'),
      failing: [{ name: 'checkout', status: 'missing' }],
    },
  ],
  [
    'a version 1 block and no data comment',
    () => '<!-- wringer-report v1\n{}\n-->',
    {
      exitCode: 1,
      message: expect.stringContaining('version 1'),
      hint: expect.stringContaining('publish'),
      failing: [],
    },
  ],
  [
    'a version 1 block and one version 2 comment',
    (markdown: string) => `<!-- wringer-report v1\n{}\n-->\n${markdown}`,
    { exitCode: 0, message: undefined, hint: undefined, failing: [] },
  ],
  [
    'a comment from a newer version',
    () => '<!-- wringer-data v3 {} -->',
    {
      exitCode: 1,
      message: expect.stringContaining('newer'),
      hint: expect.stringContaining('Upgrade'),
      failing: [],
    },
  ],
  [
    'two version 2 comments',
    (markdown: string) => `${markdown}\n${markdown}`,
    {
      exitCode: 1,
      message: expect.stringContaining('more than one'),
      hint: expect.stringContaining('publish'),
      failing: [],
    },
  ],
  [
    'a comment that fails the schema',
    () => '<!-- wringer-data v2 {"version":2} -->',
    {
      exitCode: 1,
      message: expect.stringContaining('schema'),
      hint: expect.stringContaining('publish'),
      failing: [],
    },
  ],
] as const)('#gate on a PR body with %s', async (_name, toBody, expected) => {
  const ctx = await setupTest();
  const markdown = await ctx.publishCheckout();

  await ctx.writeBody(toBody(markdown));

  const result = await ctx.runOn('prod', ['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({
    exitCode: result.exitCode,
    message: result.envelope.error?.message,
    hint: result.envelope.error?.hint,
    failing: ctx.readFailing(result.envelope.data),
  }).toStrictEqual({
    exitCode: expected.exitCode,
    message: expected.message,
    hint: expected.hint,
    failing: [...expected.failing],
  });
});

test.each([
  [
    'whose fingerprint is empty, whatever its claim',
    {
      policy: 'allow',
      edit: (comment: ReportComment) => comment,
      removes: ['src/checkout/pay.ts'],
    },
    { exitCode: 0, failing: [] },
  ],
  [
    'changed with no claim for it',
    {
      policy: 'allow',
      edit: (comment: ReportComment) => ({ ...comment, claims: [] }),
      removes: [],
    },
    { exitCode: 1, failing: [{ name: 'checkout', status: 'missing' }] },
  ],
  [
    'changed with a claim at another fingerprint',
    {
      policy: 'allow',
      removes: [],
      edit: (comment: ReportComment) => ({
        ...comment,
        claims: comment.claims.map((claim) => ({ ...claim, featureFingerprint: 'd'.repeat(40) })),
      }),
    },
    { exitCode: 1, failing: [{ name: 'checkout', status: 'stale' }] },
  ],
  [
    'with an equal claim, an unpinned pin and a policy that refuses it',
    { policy: 'refuse', edit: (comment: ReportComment) => comment, removes: [] },
    { exitCode: 1, failing: [{ name: 'checkout', status: 'unpinned' }] },
  ],
  [
    'with an equal claim and a deployed pin under a policy that refuses unpinned',
    {
      policy: 'refuse',
      removes: [],
      edit: (comment: ReportComment) => ({
        ...comment,
        claims: comment.claims.map((claim) => ({
          ...claim,
          pin: { kind: 'deployed', revision: 'e'.repeat(40) },
        })),
      }),
    },
    { exitCode: 0, failing: [] },
  ],
] as const)('#gate on a feature %s', async (_name, row, expected) => {
  const ctx = await setupTest();
  const markdown = await ctx.publishCheckout();

  await ctx.writeBody(ctx.rewriteComment(markdown, row.edit));
  await Promise.all(row.removes.map((file) => rm(join(ctx.root, file))));

  const run = { allow: ctx.runOn, refuse: ctx.runRefusing }[row.policy];

  const result = await run('prod', ['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({
    exitCode: result.exitCode,
    failing: ctx.readFailing(result.envelope.data),
  }).toStrictEqual({ exitCode: expected.exitCode, failing: [...expected.failing] });
});

test('#gate built through the gate method decides unpinned from its own policy', async () => {
  const ctx = await setupTest();
  const markdown = await ctx.publishCheckout();

  // The report, written by a registry that allows unpinned, shows the verdict as verified.
  await ctx.writeBody(markdown);

  const result = await ctx.runRefusing('prod', ['gate'], {
    base: 'main',
    bodyFile: '.wringer/body.md',
  });

  expect({
    exitCode: result.exitCode,
    failing: ctx.readFailing(result.envelope.data),
  }).toStrictEqual({ exitCode: 1, failing: [{ name: 'checkout', status: 'unpinned' }] });
});

test('#report built through the gate method marks an unpinned verdict unpinned', async () => {
  const ctx = await setupTest();

  await ctx.publishCheckout();

  const report = await ctx.runRefusing('prod', ['report']);

  expect(
    ctx
      .parseReportData(report.envelope.data)
      .report.features.map((feature) => [feature.name, feature.status]),
  ).toStrictEqual([
    ['checkout', 'unpinned'],
    ['search', 'unchanged'],
  ]);
});

test('#gate fails on an unmapped path when every feature is verified', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  await mkdir(join(ctx.root, 'scripts'));
  await writeFile(join(ctx.root, 'scripts', 'seed.ts'), 'export const seed = 1;\n');

  const report = await ctx.run(['report']);

  await ctx.writeBody(ctx.parseReportData(report.envelope.data).markdown);

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: {
      fingerprint: expect.any(String),
      failing: [],
      unmapped: ['scripts/seed.ts'],
      unknownClaims: [],
    },
  });
});

test('#gate lists a claim for a feature the registry lacks and changes no row', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const report = await ctx.run(['report']);

  await ctx.writeBody(
    ctx.rewriteComment(ctx.parseReportData(report.envelope.data).markdown, (comment) => ({
      ...comment,
      claims: [
        ...comment.claims,
        ...comment.claims.map((claim) => ({ ...claim, feature: 'ghost' })),
      ],
    })),
  );

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [], unknownClaims: ['ghost'] },
  });
});

test('#gate fails a comment that another registry wrote', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  const report = await ctx.run(['report']);

  await ctx.writeBody(
    ctx.rewriteComment(ctx.parseReportData(report.envelope.data).markdown, (comment) => ({
      ...comment,
      registry: 'other',
    })),
  );

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, message: result.envelope.error?.message }).toStrictEqual({
    exitCode: 1,
    message: expect.stringContaining('other'),
  });
});

test('#report refuses a base over 256 characters as a usage error', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['report'], { base: 'b'.repeat(257) });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

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
    featureFingerprint: 'empty',
    run: result.envelope.instance,
    at: expect.any(String),
    target: { name: 'local', evidence: 'local' },
    pin: { kind: 'local' },
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

test('#done records an unpinned verdict on an attach target', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.runOn('prod', ['attach']);
  await ctx.runOn('prod', ['doctor']);
  await ctx.runOn('prod', ['use'], { feature: 'checkout' });
  await ctx.runOn('prod', ['action', 'count']);
  await ctx.runOn('prod', ['done']);

  const recorded = await ctx.readVerdicts();

  const verdicts = [...recorded.values()];

  expect(verdicts.map((verdict) => [verdict.feature, verdict.target, verdict.pin])).toStrictEqual([
    ['checkout', { name: 'prod', evidence: 'local' }, { kind: 'unpinned' }],
  ]);
});

test('#report marks a feature verified by an unpinned verdict on an attach target', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.runOn('prod', ['attach']);
  await ctx.runOn('prod', ['doctor']);
  await ctx.runOn('prod', ['use'], { feature: 'checkout' });
  await ctx.runOn('prod', ['action', 'count']);
  await ctx.runOn('prod', ['done']);

  const report = await ctx.runOn('prod', ['report']);

  expect(
    ctx
      .parseReportData(report.envelope.data)
      .report.features.map((feature) => [feature.name, feature.status]),
  ).toStrictEqual([
    ['checkout', 'verified'],
    ['search', 'unchanged'],
  ]);
});

test('#gate passes a report whose only verdict is unpinned on an attach target', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.runOn('prod', ['attach']);
  await ctx.runOn('prod', ['doctor']);
  await ctx.runOn('prod', ['use'], { feature: 'checkout' });
  await ctx.runOn('prod', ['action', 'count']);
  await ctx.runOn('prod', ['done']);

  const report = await ctx.runOn('prod', ['report']);

  await ctx.writeBody(ctx.parseReportData(report.envelope.data).markdown);

  const gate = await ctx.runOn('prod', ['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: gate.exitCode, data: gate.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { fingerprint: expect.any(String), failing: [], unmapped: [], unknownClaims: [] },
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

test('#report gives each changed feature its status and embeds the data comment', async () => {
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

test('#report uploads the evidence of a verified feature with its bytes, name, type and label', async () => {
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
      bytes: expect.any(Uint8Array),
      filename: expect.stringMatching(/-receipt\.txt$/u),
      contentType: 'text/plain',
      label: 'shop/checkout',
      sha256: expect.any(String),
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
    data: { fingerprint: expect.any(String), failing: [], unmapped: [], unknownClaims: [] },
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
    data: { fingerprint: expect.any(String), failing: [], unmapped: [], unknownClaims: [] },
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
    data: {
      fingerprint: expect.any(String),
      failing: [],
      unmapped: ['scripts/seed.ts'],
      unknownClaims: [],
    },
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
    data: { fingerprint: expect.any(String), failing: [], unmapped: [], unknownClaims: [] },
  });
});

test('#gate fails each feature as missing when a PR changes only a path the repo shares', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'package.json'), '{}\n');

  await ctx.writeBody('No report here.');

  const result = await ctx.run(['gate'], { base: 'main', bodyFile: '.wringer/body.md' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: {
      fingerprint: expect.any(String),
      failing: [
        {
          name: 'checkout',
          reason: 'The PR body holds no wringer data comment.',
          status: 'missing',
        },
        { name: 'search', reason: 'The PR body holds no wringer data comment.', status: 'missing' },
      ],
      unmapped: [],
      unknownClaims: [],
    },
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
    unknownClaims: [],
  });
});

test('#report leaves a changed path the repo shares out of the unmapped paths, and marks every feature changed', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'package.json'), '{}\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data);

  expect({
    unmapped: data.report.unmapped,
    features: data.report.features.map((feature) => [feature.name, feature.changed]),
  }).toStrictEqual({
    unmapped: [],
    features: [
      ['checkout', true],
      ['search', true],
    ],
  });
});

test('#report keeps a verdict on checkout verified after an edit to a search file', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await mkdir(join(ctx.root, 'src', 'search'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');
  await writeFile(join(ctx.root, 'src', 'search', 'rank.ts'), 'export const rank = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  await writeFile(join(ctx.root, 'src', 'search', 'rank.ts'), 'export const rank = 2;\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data).report;

  expect(data.features.map((feature) => [feature.name, feature.status])).toStrictEqual([
    ['checkout', 'verified'],
    ['search', 'missing'],
  ]);
});

test('#report marks a verdict stale after an edit to a file of its own feature', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 2;\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data).report;

  expect(data.features.map((feature) => [feature.name, feature.status])).toStrictEqual([
    ['checkout', 'stale'],
    ['search', 'unchanged'],
  ]);
});

test('#report marks a verdict stale after an edit to a path the repo shares', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });
  await ctx.run(['done']);

  await writeFile(join(ctx.root, 'package.json'), '{}\n');

  const result = await ctx.run(['report']);

  const data = ctx.parseReportData(result.envelope.data).report;

  expect(data.features.map((feature) => [feature.name, feature.status])).toStrictEqual([
    ['checkout', 'stale'],
    ['search', 'missing'],
  ]);
});

test('#done refuses on a launch target after an edit inside the feature since up', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['notes', 'add'], { text: 'pay' });

  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  const result = await ctx.run(['done']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    hint: result.envelope.error?.hint,
  }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
    hint: expect.stringContaining('up --restart'),
  });
});

test('#done accepts on a launch target after an edit outside the feature since up', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'search'), { recursive: true });

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  await writeFile(join(ctx.root, 'src', 'search', 'rank.ts'), 'export const rank = 1;\n');

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 0,
    error: null,
  });
});

test('#done refuses a launch run that recorded no scopes', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);
  await ctx.dropScopes();

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('#done refuses a feature the registry does not list', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);

  const result = await ctx.run(['done'], { feature: 'wishlist' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('#up writes the feature fingerprints in a scopes-read event right after run-started', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'search'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'search', 'rank.ts'), 'export const rank = 1;\n');

  const up = await ctx.run(['up']);
  const events = await ctx.readEvents(runIDSchema.parse(up.envelope.instance));

  expect(events.slice(0, 2).map((event) => event.type)).toStrictEqual([
    'run-started',
    'scopes-read',
  ]);

  expect(events[1]).toStrictEqual({
    type: 'scopes-read',
    at: expect.any(String),
    featureFingerprints: [
      ['checkout', 'empty'],
      ['search', expect.stringMatching(/^[0-9a-f]{40}$/u)],
    ],
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
    uploaded: ctx.uploads.map((file) => file.contentType),
    urls: checkout?.verdict?.evidence.map((item) => [item.kind, item.url]),
  }).toStrictEqual({
    uploaded: ['text/plain'],
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

test.each([
  { name: 'notes.apiToken', value: 'for the cart' },
  { name: 'notes.url', value: 'paid 12 for' },
])(
  '#report refuses an upload that holds the driver config secret $name that a drive kept',
  async (secret) => {
    const ctx = await setupTest();
    const runID = await ctx.verifyCheckout('photo');

    await ctx.keepSecret(runID, secret.name, secret.value);

    const result = await ctx.runWithUpload(['report']);

    expect({
      code: result.envelope.error?.code,
      exitCode: result.exitCode,
      uploads: ctx.uploads,
    }).toStrictEqual({ code: 'internal', exitCode: 4, uploads: [] });
  },
);

test('#done records the evidence setting of its target, and #report then uploads an opaque file', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.runOnUploadingTarget(['up']);
  await ctx.runOnUploadingTarget(['doctor']);
  await ctx.runOnUploadingTarget(['use'], { feature: 'checkout' });
  await ctx.runOnUploadingTarget(['action', 'photo']);
  await ctx.runOnUploadingTarget(['done']);
  await ctx.runOnUploadingTarget(['report']);

  const verdicts = await ctx.readVerdicts();

  expect({
    evidence: [...verdicts.values()].map((verdict) => verdict.target.evidence),
    uploaded: ctx.uploads.map((file) => file.contentType),
  }).toStrictEqual({
    evidence: ['upload'],
    uploaded: ['text/plain', 'image/png'],
  });
});
