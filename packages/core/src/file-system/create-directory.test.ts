import { expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createDirectory } from './create-directory.ts';

function setupTest() {
  const directory = createTempDir('create-directory').path;

  return { directory };
}

test('it creates the folder and its missing parents', async () => {
  const ctx = setupTest();

  await createDirectory(join(ctx.directory, 'garden/beds'));

  const names = await readdir(join(ctx.directory, 'garden'));

  expect(names).toStrictEqual(['beds']);
});

test('it accepts a folder that exists', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.directory, 'garden'));

  expect(createDirectory(join(ctx.directory, 'garden'))).resolves.toBeUndefined();
});
