import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createShopWringer } from '../../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../../test-utils/create-test-session.ts';
import type { StatePort } from '../create-file-state.ts';
import { dispatch } from '../dispatch.ts';
import { readVerdicts } from '../read-verdicts.ts';
import { reportSchema } from '../report-schema.ts';
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

  // Another doctor fails after `done` read the run and before its envelope reaches the log.
  const racedState: StatePort = {
    ...shop.state,
    appendEventUnless: async (runID, event, refuse) => {
      await shop.state.appendEvent(runID, {
        type: 'doctor-failed',
        at: '2026-11-05T09:00:00.000Z',
        results: [
          { name: 'shop', status: 'failed', durationMs: 4, code: 'check-failed', message: null },
        ],
      });

      await shop.state.appendEventUnless(runID, event, refuse);
    },
  };

  return {
    root: shop.repo.root,
    git: shop.repo.git,
    uploads,
    run: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local' }),
    runWhileDoctorFails: (path: readonly string[]) =>
      dispatch(wringer, path, {}, { ...shop.session, state: racedState, target: 'local' }),
    readVerdicts: () => readVerdicts(shop.state, shop.session.repoHost, shop.repo.root),
    runWithUpload: (path: readonly string[]) =>
      dispatch(uploading, path, {}, { ...shop.session, target: 'local' }),
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
      { kind: 'note', path: expect.stringMatching(/receipt\.txt$/u), sha256: expect.any(String) },
    ],
  });
});

test('#done refuses and records no verdict when another doctor fails before its envelope is logged', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'receipt']);

  const result = await ctx.runWhileDoctorFails(['done']);
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
    data: { fingerprint: expect.any(String), failing: [] },
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
    data: { fingerprint: expect.any(String), failing: [] },
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
  });
});
