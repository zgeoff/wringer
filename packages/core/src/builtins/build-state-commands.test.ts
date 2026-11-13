import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRunPaths } from '../build-state-paths.ts';
import { dispatch } from '../dispatch.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    readPointers: () => shop.state.readPointers(),
    streamsOf: (runID: string) =>
      buildRunPaths(join(shop.repo.root, wringer.stateDir), runID).streams,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),

    // The registry as a later version of the repo declares it, with one target removed.
    runWithoutTarget: (removed: string, path: readonly string[], args: unknown) =>
      dispatch(
        { ...wringer, targets: new Map([...wringer.targets].filter(([name]) => name !== removed)) },
        path,
        args,
        { ...shop.session, target: undefined },
      ),
  };
}

test('#use marks the cursors of the current target run', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  const streams = ctx.streamsOf(up.envelope.instance ?? '');

  await mkdir(streams, { recursive: true });
  await writeFile(join(streams, 'app.ndjson'), '{"at":"t","line":"booted"}\n');

  const result = await ctx.run('local', ['use'], { feature: 'checkout' });

  expect(result.envelope.data).toStrictEqual({
    target: null,
    feature: 'checkout',
    cursors: { app: 27 },
  });
});

test('#use --target selects a target after the registry dropped the saved one', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['use'], { target: 'archive' });

  const result = await ctx.runWithoutTarget('archive', ['use'], { target: 'local' });
  const pointers = await ctx.readPointers();

  expect({ exitCode: result.exitCode, target: pointers.target }).toStrictEqual({
    exitCode: 0,
    target: 'local',
  });
});

test('#use treats a target named after an inherited object key as one with no run', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('constructor', ['use'], { feature: 'checkout' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { target: null, feature: 'checkout', cursors: {} },
  });
});

test('#status treats a target named after an inherited object key as one with no run', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('constructor', ['status']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 0,
    code: undefined,
  });
});

test('#use saves the run that its cursors belong to', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  await ctx.run('local', ['use'], { feature: 'checkout' });

  const pointers = await ctx.readPointers();

  expect(pointers.cursorsRun).toBe(up.envelope.instance ?? '');
});

test('#use --target drops the run of cursors it no longer holds', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['use'], { feature: 'checkout' });
  await ctx.run('local', ['use'], { target: 'prod' });

  const pointers = await ctx.readPointers();

  expect(pointers.cursorsRun).toBeUndefined();
});

test('#use --target marks the cursors of the run of the target it selects', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  const streams = ctx.streamsOf(up.envelope.instance ?? '');

  await mkdir(streams, { recursive: true });
  await writeFile(join(streams, 'app.ndjson'), '{"at":"t","line":"booted"}\n');

  const result = await ctx.run('local', ['use'], { target: 'prod' });

  expect(result.envelope.data).toStrictEqual({ target: 'prod', feature: null, cursors: {} });
});

test('#features lists each feature with its paths and file, the shared globs and the ignore list, with no run', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['features']);

  expect({ ok: result.envelope.ok, instance: result.envelope.instance }).toStrictEqual({
    ok: true,
    instance: null,
  });

  expect(result.envelope.data).toStrictEqual({
    features: [
      {
        name: 'checkout',
        summary: 'Pay for the cart',
        paths: ['src/checkout/**'],
        file: 'references/feature-checkout.md',
      },
      {
        name: 'search',
        summary: 'Find a product',
        paths: ['src/search/**'],
        file: 'references/feature-search.md',
      },
    ],
    shared: ['package.json'],
    ignore: ['**/*.md'],
  });
});

test('#features --markdown adds the feature table, one row per feature in registry order', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['features'], { markdown: true });

  expect(result.envelope.data).toStrictEqual({
    features: [
      {
        name: 'checkout',
        summary: 'Pay for the cart',
        paths: ['src/checkout/**'],
        file: 'references/feature-checkout.md',
      },
      {
        name: 'search',
        summary: 'Find a product',
        paths: ['src/search/**'],
        file: 'references/feature-search.md',
      },
    ],
    shared: ['package.json'],
    ignore: ['**/*.md'],
    markdown: [
      '| Feature | Summary | File |',
      '| --- | --- | --- |',
      '| checkout | Pay for the cart | [references/feature-checkout.md](references/feature-checkout.md) |',
      '| search | Find a product | [references/feature-search.md](references/feature-search.md) |',
    ].join('\n'),
  });
});
