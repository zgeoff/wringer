import { expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { nodeFileSystem } from './ci/node-file-system.ts';
import { pickStaleTestFolders, removeStaleTestFolders } from './remove-stale-test-folders.ts';

function setupTest() {
  const root = createTempDir('remove-stale-test-folders').path;

  return {
    root,
    removeStale: (livePIDs: readonly number[]) =>
      removeStaleTestFolders({
        root,
        namespace: '4026531836',
        fileSystem: nodeFileSystem,
        probeProcess: (pid) => livePIDs.includes(pid),
      }),
    readNames: () => readdir(root),
  };
}

test.each([
  {
    name: 'bedspid4100-ns4026531836-a1b2c3',
    livePIDs: [],
    stale: ['/tmp/bedspid4100-ns4026531836-a1b2c3'],
  },
  { name: 'bedspid4100-ns4026531836-a1b2c3', livePIDs: [4100], stale: [] },
  { name: 'bedspid4100-ns4026532001-a1b2c3', livePIDs: [], stale: [] },
  { name: 'bedspid4100-a1b2c3', livePIDs: [], stale: [] },
  { name: 'beds-a1b2c3', livePIDs: [], stale: [] },
])('#pickStaleTestFolders reads $name with live PIDs $livePIDs as stale: $stale', (row) => {
  const stale = pickStaleTestFolders([{ name: row.name, path: `/tmp/${row.name}` }], {
    namespace: '4026531836',
    livePIDs: new Set(row.livePIDs),
  });

  expect(stale).toStrictEqual(row.stale);
});

test('it removes a test folder whose process no longer runs', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.root, 'bedspid4100-ns4026531836-a1b2c3'));

  const removed = await ctx.removeStale([]);

  expect(removed).toStrictEqual([join(ctx.root, 'bedspid4100-ns4026531836-a1b2c3')]);
});

test('it keeps a test folder whose process still runs on disk', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.root, 'bedspid4100-ns4026531836-a1b2c3'));

  await ctx.removeStale([4100]);

  const names = await ctx.readNames();

  expect(names).toStrictEqual(['bedspid4100-ns4026531836-a1b2c3']);
});

test('it keeps a test folder from another PID namespace, whatever its PID', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.root, 'bedspid4100-ns4026532001-a1b2c3'));

  await ctx.removeStale([]);

  const names = await ctx.readNames();

  expect(names).toStrictEqual(['bedspid4100-ns4026532001-a1b2c3']);
});

test('it keeps a folder that the kit did not name', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.root, 'node_modules'));

  await ctx.removeStale([]);

  const names = await ctx.readNames();

  expect(names).toStrictEqual(['node_modules']);
});
