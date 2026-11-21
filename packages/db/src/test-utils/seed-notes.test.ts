import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { seedNotes } from './seed-notes.ts';

function setupTest() {
  const directory = createTempDir('seed-notes').path;
  const file = join(directory, 'shop.db');

  return {
    file,
    readNotes: () => {
      using database = new Database(file, { readonly: true });

      return database.query('select id, text from notes order by id').all();
    },
  };
}

test('it writes one numbered note row per text, in order', () => {
  const ctx = setupTest();

  seedNotes(ctx.file, ['pay', 'ship']);

  expect(ctx.readNotes()).toStrictEqual([
    { id: 1, text: 'pay' },
    { id: 2, text: 'ship' },
  ]);
});

test('it creates an empty notes table for no texts', () => {
  const ctx = setupTest();

  seedNotes(ctx.file, []);

  expect(ctx.readNotes()).toStrictEqual([]);
});
