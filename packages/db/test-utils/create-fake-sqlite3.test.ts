import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createFakeSqlite3 } from './create-fake-sqlite3.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'fake-sqlite3');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const program = await createFakeSqlite3(directory);

  const file = join(directory, 'shop.db');

  return {
    file,

    // `using` closes the database even when a statement throws.
    seedNotes: (texts: readonly string[]) => {
      using database = new Database(file);

      database.run('create table notes (text text)');

      for (const text of texts) {
        database.run('insert into notes values (?)', [text]);
      }
    },
    run: (args: readonly string[], sql: string) =>
      runProcess({ argv: [program, ...args], stdin: sql }),
  };
}

test('it prints the rows of a read as JSON', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay']);

  const result = await ctx.run(['-json', '-readonly', ctx.file], 'select text from notes');

  expect(result).toStrictEqual({ exitCode: 0, stdout: '[{"text":"pay"}]\n', stderr: '' });
});

test('it runs each statement of a script and prints the rows of each read that has any', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay', 'ship']);

  const result = await ctx.run(
    ['-json', '-readonly', ctx.file],
    "create temp view open_notes as\nselect text from notes\n;\nselect count(*) as total from open_notes;\nselect text from open_notes where text = 'none';\n",
  );

  expect(result).toStrictEqual({ exitCode: 0, stdout: '[{"total":2}]\n', stderr: '' });
});

test('it refuses a flag it does not take', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay']);

  const result = await ctx.run(['-json', '-bail', ctx.file], 'select text from notes');

  expect({ exitCode: result.exitCode, stdout: result.stdout }).toStrictEqual({
    exitCode: 1,
    stdout: '',
  });
});

test('it refuses a call with no database file', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['-json', '-readonly'], 'select 1');

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: '',
    stderr: 'Error: pass one database file\n',
  });
});

test('it refuses a write with -readonly as sqlite3 does', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  const result = await ctx.run(['-json', '-readonly', ctx.file], "insert into notes values ('x')");

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: '',
    stderr: 'Error: attempt to write a readonly database\n',
  });
});
