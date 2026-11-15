import { expect, onTestFinished, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from './create-test-folder.ts';
import { removeTestFolder } from './remove-test-folder.ts';

async function setupTest() {
  const folder = await createTestFolder(import.meta.dir, 'remove-test-folder');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder };
}

test('it removes a folder with the files and folders inside it', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.folder, 'beds/north'), { recursive: true });
  await writeFile(join(ctx.folder, 'beds/north/tulips.txt'), 'twelve\n');
  await removeTestFolder(ctx.folder);

  expect(existsSync(ctx.folder)).toBe(false);
});

test('it treats a folder that is already gone as removed', async () => {
  const ctx = await setupTest();

  await rm(ctx.folder, { recursive: true });

  await expect(removeTestFolder(ctx.folder)).toResolve();
});
