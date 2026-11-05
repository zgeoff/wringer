import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { readOptionalText } from './read-optional-text.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-optional-text');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it reads the text of a file', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'plant beans\n');

  const text = await readOptionalText(join(ctx.directory, 'notes.txt'));

  expect(text).toBe('plant beans\n');
});

test('it reads a missing file as null', async () => {
  const ctx = await setupTest();
  const text = await readOptionalText(join(ctx.directory, 'notes.txt'));

  expect(text).toBeNull();
});

test('it rejects a path that is a folder', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.directory, 'notes.txt'));

  expect(readOptionalText(join(ctx.directory, 'notes.txt'))).rejects.toMatchObject({
    code: 'EISDIR',
  });
});
