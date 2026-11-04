import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createDirectory } from './create-directory.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-directory');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it creates the folder and its missing parents', async () => {
  const ctx = await setupTest();

  await createDirectory(join(ctx.directory, 'garden/beds'));

  const names = await readdir(join(ctx.directory, 'garden'));

  expect(names).toStrictEqual(['beds']);
});

test('it accepts a folder that exists', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.directory, 'garden'));

  expect(createDirectory(join(ctx.directory, 'garden'))).resolves.toBeUndefined();
});
