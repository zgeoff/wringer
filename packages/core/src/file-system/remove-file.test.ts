import { expect, test } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { removeFile } from './remove-file.ts';

function setupTest() {
  const directory = createTempDir('remove-file').path;

  return { directory };
}

test('it removes the file', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'seeds.txt'), 'beans');
  await removeFile(join(ctx.directory, 'seeds.txt'));

  const names = await readdir(ctx.directory);

  expect(names).toStrictEqual([]);
});

test('it accepts a file that does not exist', () => {
  const ctx = setupTest();

  expect(removeFile(join(ctx.directory, 'seeds.txt'))).resolves.toBeUndefined();
});
