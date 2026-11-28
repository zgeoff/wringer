import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { local } from '../host/local.ts';
import { createWringer } from '../registry/create-wringer.ts';
import { buildRunPaths } from '../state/build-state-paths.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { seedImportWorkspace } from '../test-utils/seed-import-workspace.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ wringer });

  const importing = createWringer({ name: 'imports' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .feature(
      {
        name: 'app',
        summary: 'The app',
        entries: ['packages/app/src/main.ts'],
        extra: ['packages/app/journeys/**'],
      },
      { name: 'docs', summary: 'The docs', paths: ['docs/**'] },
    )
    .build();

  return {
    lines: shop.lines,

    // Commits the two-package workspace and runs a command of a registry whose `app` feature starts
    // at the app's entry file, with `feature` as the `--feature` flag.
    runImports: async (path: readonly string[], feature?: string) => {
      await seedImportWorkspace(shop.repo.root);

      return shop.dispatch(importing, path, {}, { ...shop.session, target: 'local', feature });
    },
    readPointers: () => shop.state.readPointers(),
    streamsOf: (runID: string) =>
      buildRunPaths(join(shop.repo.root, wringer.stateDir), runID).streams,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      shop.dispatch(wringer, path, args, { ...shop.session, target }),

    // The registry as a later version of the repo declares it, with one target removed.
    runWithoutTarget: (removed: string, path: readonly string[], args: unknown) =>
      shop.dispatch(
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
        entries: [],
        extra: [],
        paths: ['src/checkout/**'],
        reached: 0,
        file: 'references/feature-checkout.md',
      },
      {
        name: 'search',
        summary: 'Find a product',
        entries: [],
        extra: [],
        paths: ['src/search/**'],
        reached: 0,
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
        entries: [],
        extra: [],
        paths: ['src/checkout/**'],
        reached: 0,
        file: 'references/feature-checkout.md',
      },
      {
        name: 'search',
        summary: 'Find a product',
        entries: [],
        extra: [],
        paths: ['src/search/**'],
        reached: 0,
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

test('#features prints the count of files each feature reaches, and no file list', async () => {
  const ctx = await setupTest();
  const result = await ctx.runImports(['features']);

  expect(result.envelope.data).toMatchObject({
    features: [
      { name: 'app', entries: ['packages/app/src/main.ts'], reached: 5 },
      { name: 'docs', entries: [], reached: 0 },
    ],
  });
});

test('#features --feature lists the files the feature reaches, and only for that feature', async () => {
  const ctx = await setupTest();
  const result = await ctx.runImports(['features'], 'app');

  const featureSchema = z.looseObject({ name: z.string(), files: z.array(z.string()).optional() });
  const listed = z.looseObject({ features: z.array(featureSchema) }).parse(result.envelope.data);

  expect(listed.features.map((feature) => [feature.name, feature.files])).toStrictEqual([
    [
      'app',
      [
        'packages/app/src/aliased.ts',
        'packages/app/src/helper.ts',
        'packages/app/src/main.ts',
        'packages/lib/src/area.ts',
        'packages/lib/src/deep.ts',
      ],
    ],
    ['docs', undefined],
  ]);
});

test('#features warns with the file and line of an import() whose path is not a literal', async () => {
  const ctx = await setupTest();

  await ctx.runImports(['features']);

  const lineSchema = z.looseObject({ wringer: z.number(), event: z.string(), data: z.unknown() });

  expect(ctx.lines.map((line) => lineSchema.parse(JSON.parse(line)))).toStrictEqual([
    {
      wringer: expect.any(Number),
      event: 'warning',
      data: {
        message:
          'packages/app/src/main.ts:6: an import() with a path that is not a literal, so the walk cannot follow it',
      },
    },
  ]);
});
