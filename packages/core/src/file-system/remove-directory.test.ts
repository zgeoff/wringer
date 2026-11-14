import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { removeDirectory } from './remove-directory.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'remove-directory');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it removes the folder and the files in it', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.directory, 'shed', 'pots'), { recursive: true });
  await writeFile(join(ctx.directory, 'shed', 'pots', 'seeds.txt'), 'beans');
  await removeDirectory(join(ctx.directory, 'shed'));

  const names = await readdir(ctx.directory);

  expect(names).toStrictEqual([]);
});

test('it accepts a folder that does not exist', async () => {
  const ctx = await setupTest();

  expect(removeDirectory(join(ctx.directory, 'shed'))).resolves.toBeUndefined();
});
