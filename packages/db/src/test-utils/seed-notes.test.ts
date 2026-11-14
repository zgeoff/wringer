import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { seedNotes } from './seed-notes.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'seed-notes');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');

  return {
    file,
    readNotes: () => {
      using database = new Database(file, { readonly: true });

      return database.query('select id, text from notes order by id').all();
    },
  };
}

test('it writes one numbered note row per text, in order', async () => {
  const ctx = await setupTest();

  seedNotes(ctx.file, ['pay', 'ship']);

  expect(ctx.readNotes()).toStrictEqual([
    { id: 1, text: 'pay' },
    { id: 2, text: 'ship' },
  ]);
});

test('it creates an empty notes table for no texts', async () => {
  const ctx = await setupTest();

  seedNotes(ctx.file, []);

  expect(ctx.readNotes()).toStrictEqual([]);
});
