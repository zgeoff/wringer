import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { appendText } from './append-text.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'append-text');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it adds the text after what the file holds', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'plant beans\n');
  await appendText(join(ctx.directory, 'notes.txt'), 'water beans\n');

  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect(text).toBe('plant beans\nwater beans\n');
});

test('it creates a file that does not exist', async () => {
  const ctx = await setupTest();

  await appendText(join(ctx.directory, 'notes.txt'), 'plant beans\n');

  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect(text).toBe('plant beans\n');
});
