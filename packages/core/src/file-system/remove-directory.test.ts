import { expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { removeDirectory } from './remove-directory.ts';

function setupTest() {
  const directory = createTempDir('remove-directory').path;

  return { directory };
}

test('it removes the folder and the files in it', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.directory, 'shed', 'pots'), { recursive: true });
  await writeFile(join(ctx.directory, 'shed', 'pots', 'seeds.txt'), 'beans');
  await removeDirectory(join(ctx.directory, 'shed'));

  const names = await readdir(ctx.directory);

  expect(names).toStrictEqual([]);
});

test('it accepts a folder that does not exist', () => {
  const ctx = setupTest();

  expect(removeDirectory(join(ctx.directory, 'shed'))).resolves.toBeUndefined();
});
