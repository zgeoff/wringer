import { expect, onTestFinished, test } from 'bun:test';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { removeFile } from './remove-file.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'remove-file');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it removes the file', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'seeds.txt'), 'beans');
  await removeFile(join(ctx.directory, 'seeds.txt'));

  const names = await readdir(ctx.directory);

  expect(names).toStrictEqual([]);
});

test('it accepts a file that does not exist', async () => {
  const ctx = await setupTest();

  expect(removeFile(join(ctx.directory, 'seeds.txt'))).resolves.toBeUndefined();
});
