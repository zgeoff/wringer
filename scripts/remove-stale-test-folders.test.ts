import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { nodeFileSystem } from './ci/node-file-system.ts';
import { pickStaleTestFolders, removeStaleTestFolders } from './remove-stale-test-folders.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'remove-stale-test-folders');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    removeStale: (livePIDs: readonly number[]) =>
      removeStaleTestFolders({
        root,
        namespace: '4026531836',
        fileSystem: nodeFileSystem,
        probeProcess: (pid) => livePIDs.includes(pid),
      }),
    readNames: (folder: string) => readdir(join(root, folder)),
  };
}

test.each([
  {
    name: '.test-n4026531836-p4100-beds-a1b2c3',
    livePIDs: [],
    stale: ['/repo/src/.test-n4026531836-p4100-beds-a1b2c3'],
  },
  { name: '.test-n4026531836-p4100-beds-a1b2c3', livePIDs: [4100], stale: [] },
  { name: '.test-n4026532001-p4100-beds-a1b2c3', livePIDs: [], stale: [] },
  { name: '.test-p4100-beds-a1b2c3', livePIDs: [], stale: [] },
  { name: '.test-beds-a1b2c3', livePIDs: [], stale: [] },
])('#pickStaleTestFolders reads $name with live PIDs $livePIDs as stale: $stale', (row) => {
  const stale = pickStaleTestFolders([{ name: row.name, path: `/repo/src/${row.name}` }], {
    namespace: '4026531836',
    livePIDs: new Set(row.livePIDs),
  });

  expect(stale).toStrictEqual(row.stale);
});

test('it removes a nested test folder whose process no longer runs', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'packages/garden/src/.test-n4026531836-p4100-beds-a1b2c3'), {
    recursive: true,
  });

  const removed = await ctx.removeStale([]);

  expect(removed).toStrictEqual([
    join(ctx.root, 'packages/garden/src/.test-n4026531836-p4100-beds-a1b2c3'),
  ]);
});

test('it keeps a test folder whose process still runs on disk', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src/.test-n4026531836-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([4100]);

  const names = await ctx.readNames('src');

  expect(names).toStrictEqual(['.test-n4026531836-p4100-beds-a1b2c3']);
});

test('it keeps a test folder from another PID namespace, whatever its PID', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src/.test-n4026532001-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([]);

  const names = await ctx.readNames('src');

  expect(names).toStrictEqual(['.test-n4026532001-p4100-beds-a1b2c3']);
});

test('it leaves the dependency folders unread', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'node_modules/.test-n4026531836-p4100-beds-a1b2c3'), {
    recursive: true,
  });

  await ctx.removeStale([]);

  const names = await ctx.readNames('node_modules');

  expect(names).toStrictEqual(['.test-n4026531836-p4100-beds-a1b2c3']);
});
