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
        fileSystem: nodeFileSystem,
        probeProcess: (pid) => livePIDs.includes(pid),
      }),
    readNames: (folder: string) => readdir(join(root, folder)),
  };
}

test('#pickStaleTestFolders picks a folder whose process no longer runs', () => {
  const stale = pickStaleTestFolders(
    [{ name: '.test-p4100-beds-a1b2c3', path: '/repo/src/.test-p4100-beds-a1b2c3' }],
    new Set(),
  );

  expect(stale).toStrictEqual(['/repo/src/.test-p4100-beds-a1b2c3']);
});

test('#pickStaleTestFolders keeps a folder whose process still runs', () => {
  const stale = pickStaleTestFolders(
    [{ name: '.test-p4100-beds-a1b2c3', path: '/repo/src/.test-p4100-beds-a1b2c3' }],
    new Set([4100]),
  );

  expect(stale).toStrictEqual([]);
});

test('#pickStaleTestFolders keeps a folder with no process in its name', () => {
  const stale = pickStaleTestFolders(
    [{ name: '.test-beds-a1b2c3', path: '/repo/src/.test-beds-a1b2c3' }],
    new Set(),
  );

  expect(stale).toStrictEqual([]);
});

test('it removes a nested test folder whose process no longer runs', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'packages/garden/src/.test-p4100-beds-a1b2c3'), { recursive: true });

  const removed = await ctx.removeStale([]);

  expect(removed).toStrictEqual([join(ctx.root, 'packages/garden/src/.test-p4100-beds-a1b2c3')]);
});

test('it keeps a test folder whose process still runs on disk', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src/.test-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([4100]);

  const names = await ctx.readNames('src');

  expect(names).toStrictEqual(['.test-p4100-beds-a1b2c3']);
});

test('it leaves the dependency folders unread', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'node_modules/.test-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([]);

  const names = await ctx.readNames('node_modules');

  expect(names).toStrictEqual(['.test-p4100-beds-a1b2c3']);
});
