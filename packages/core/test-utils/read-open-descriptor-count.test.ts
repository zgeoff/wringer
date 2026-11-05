import { expect, onTestFinished, test } from 'bun:test';
import { open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { readOpenDescriptorCount } from './read-open-descriptor-count.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'open-descriptors');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const path = join(directory, 'run.lock');

  await writeFile(path, '');

  return {
    path,
    openFile: async () => {
      const handle = await open(path, 'r');

      onTestFinished(() => handle.close());
    },
  };
}

test('it counts no descriptor for a file this process has not opened', async () => {
  const ctx = await setupTest();
  const count = await readOpenDescriptorCount(ctx.path);

  expect(count).toBe(0);
});

test('it counts each descriptor this process holds open on the file', async () => {
  const ctx = await setupTest();

  await ctx.openFile();
  await ctx.openFile();

  const count = await readOpenDescriptorCount(ctx.path);

  expect(count).toBe(2);
});
