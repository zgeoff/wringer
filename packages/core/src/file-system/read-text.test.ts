import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { readText } from './read-text.ts';

function setupTest() {
  const directory = createTempDir('read-text').path;

  return { directory };
}

test('it reads a file as UTF-8 text', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'menu.txt'), 'crème brûlée');

  expect(readText(join(ctx.directory, 'menu.txt'))).resolves.toBe('crème brûlée');
});

test('it rejects a missing file with ENOENT', () => {
  const ctx = setupTest();

  expect(readText(join(ctx.directory, 'menu.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});
