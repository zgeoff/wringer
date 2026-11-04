import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { probeProcess, removeStaleTestFolders } from './remove-stale-test-folders.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'remove-stale-test-folders');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    removeStale: (livePIDs: readonly number[]) =>
      removeStaleTestFolders({ root, probeProcess: (pid) => livePIDs.includes(pid) }),
    readNames: (folder: string) => readdir(join(root, folder)),
  };
}

test('it removes a test folder whose process no longer runs', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'packages/garden/src/.test-p4100-beds-a1b2c3'), { recursive: true });

  const removed = await ctx.removeStale([]);

  expect(removed).toStrictEqual([join(ctx.root, 'packages/garden/src/.test-p4100-beds-a1b2c3')]);
});

test('it keeps a test folder whose process still runs', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src/.test-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([4100]);

  const names = await ctx.readNames('src');

  expect(names).toStrictEqual(['.test-p4100-beds-a1b2c3']);
});

test('it keeps a test folder with no process in its name', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src/.test-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([]);

  const names = await ctx.readNames('src');

  expect(names).toStrictEqual(['.test-beds-a1b2c3']);
});

test('it leaves the dependency folders unread', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'node_modules/.test-p4100-beds-a1b2c3'), { recursive: true });

  await ctx.removeStale([]);

  const names = await ctx.readNames('node_modules');

  expect(names).toStrictEqual(['.test-p4100-beds-a1b2c3']);
});

test('#probeProcess answers true for a process that runs', () => {
  expect(probeProcess(process.pid)).toBeTrue();
});

test('#probeProcess answers false for a process that exited', async () => {
  const child = Bun.spawn(['true']);

  await child.exited;

  expect(probeProcess(child.pid)).toBeFalse();
});
