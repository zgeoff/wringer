import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { readText } from './read-text.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-text');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it reads a file as UTF-8 text', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'menu.txt'), 'crème brûlée');

  expect(readText(join(ctx.directory, 'menu.txt'))).resolves.toBe('crème brûlée');
});

test('it rejects a missing file with ENOENT', async () => {
  const ctx = await setupTest();

  expect(readText(join(ctx.directory, 'menu.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});
