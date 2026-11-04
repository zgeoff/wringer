import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { runSQLQuery } from './run-sql-query.ts';
import type { SqliteMode } from './run-sql-query.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-sql-query');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');

  const clients = {
    openSqlite: (path: string, mode: SqliteMode) => new Database(path, { [mode]: true }),
    openPostgres: (url: string) => new SQL(url),
  };

  return {
    directory,
    file,
    seedNotes: (texts: readonly string[]) => {
      const database = new Database(file);

      database.run('create table notes (id integer primary key, text text not null)');

      for (const text of texts) {
        database.run('insert into notes (text) values (?)', [text]);
      }

      database.close();
    },
    runQuery: (
      sql: string,
      options: { params?: readonly unknown[]; write?: boolean; signal?: AbortSignal } = {},
    ) =>
      runSQLQuery(
        {
          adapter: 'sqlite',
          url: file,
          sql,
          params: options.params ?? [],
          write: options.write ?? false,
          signal: options.signal ?? new AbortController().signal,
        },
        clients,
      ),
  };
}

test('it refuses a write whose deadline passed before it started, and writes nothing', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay']);

  const failure = await ctx
    .runQuery("insert into notes (text) values ('ship')", {
      write: true,
      signal: AbortSignal.abort(),
    })
    .catch((error: unknown) => error);

  const notes = await ctx.runQuery('select text from notes');

  expect({ failure, rows: notes.rows }).toStrictEqual({
    failure: expect.objectContaining({ code: 'timeout' }),
    rows: [{ text: 'pay' }],
  });
});

test('it reads rows with bound parameters, their columns and their count', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay', 'ship']);

  const result = await ctx.runQuery('select id, text from notes where id = ?', { params: [2] });

  expect(result).toStrictEqual({
    columns: ['id', 'text'],
    rows: [{ id: 2, text: 'ship' }],
    rowCount: 1,
  });
});

test('it keeps the column names of a read that returns no rows', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  const result = await ctx.runQuery('select id, text from notes where 1 = 0');

  expect(result).toStrictEqual({ columns: ['id', 'text'], rows: [], rowCount: 0 });
});

test('it counts the rows a write changed', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay', 'ship', 'pack']);

  const result = await ctx.runQuery("update notes set text = 'done' where id < 3", {
    write: true,
  });

  expect(result).toStrictEqual({ columns: [], rows: [], rowCount: 2 });
});

test('it lets SQLite refuse a write on a read', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  expect(ctx.runQuery("insert into notes (text) values ('pay')")).rejects.toMatchObject({
    code: 'SQLITE_READONLY',
  });
});

test('it lets SQLite refuse a copy of the database to another file on a read', async () => {
  const ctx = await setupTest();

  const copy = join(ctx.directory, 'copy.db');

  ctx.seedNotes(['pay']);

  expect(ctx.runQuery(`vacuum into '${copy}'`)).rejects.toMatchObject({ code: 'SQLITE_READONLY' });
});

test('it fails with the SQLite code when the database file does not exist', async () => {
  const ctx = await setupTest();

  expect(ctx.runQuery('select 1')).rejects.toMatchObject({ code: 'SQLITE_CANTOPEN' });
});

test('it refuses a parameter SQLite cannot bind with a usage error', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  expect(ctx.runQuery('select ?', { params: [{ shelf: 'a' }] })).rejects.toMatchObject({
    code: 'usage',
  });
});
