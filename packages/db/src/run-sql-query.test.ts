import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createFakePostgres } from '../test-utils/create-fake-postgres.ts';
import { runSQLQuery } from './run-sql-query.ts';
import type { SqliteMode } from './run-sql-query.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-sql-query');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');
  const postgres = createFakePostgres();

  onTestFinished(() => {
    postgres.stop();
  });

  const clients = {
    openSqlite: (path: string, mode: SqliteMode) => new Database(path, { [mode]: true }),
    openPostgres: (url: string, sessionName: string) =>
      new SQL(url, { connection: { application_name: sessionName } }),
  };

  return {
    directory,
    file,
    postgresStatements: postgres.statements,
    runPostgresQuery: (
      sql: string,
      options: { params?: readonly unknown[]; write?: boolean; signal?: AbortSignal } = {},
    ) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: options.params ?? [],
          write: options.write ?? false,
          signal: options.signal ?? new AbortController().signal,
        },
        clients,
      ),

    // `using` closes the database even when a statement throws.
    seedNotes: (texts: readonly string[]) => {
      using database = new Database(file);

      database.run('create table notes (id integer primary key, text text not null)');

      for (const text of texts) {
        database.run('insert into notes (text) values (?)', [text]);
      }
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

test('it sends a Postgres read with no parameters as one extended-protocol statement in a read-only transaction', async () => {
  const ctx = await setupTest();

  await ctx.runPostgresQuery('COMMIT; DELETE FROM notes');

  expect(ctx.postgresStatements).toStrictEqual([
    { protocol: 'simple', sql: 'BEGIN read only' },
    { protocol: 'extended', sql: 'COMMIT; DELETE FROM notes' },
    { protocol: 'simple', sql: 'COMMIT' },
  ]);
});

test('it sends a Postgres write with no parameters as one extended-protocol statement', async () => {
  const ctx = await setupTest();

  await ctx.runPostgresQuery('DELETE FROM notes; DROP TABLE notes', { write: true });

  expect(ctx.postgresStatements).toStrictEqual([
    { protocol: 'extended', sql: 'DELETE FROM notes; DROP TABLE notes' },
  ]);
});

test.each([
  { write: true, kind: 'write' },
  { write: false, kind: 'read' },
])('it cancels a running Postgres $kind in the database when its signal aborts', async (row) => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const running = ctx.runPostgresQuery('select pg_sleep(60)', {
    write: row.write,
    signal: controller.signal,
  });

  await waitFor(() =>
    ctx.postgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)')
      ? true
      : null,
  );

  controller.abort();

  expect(running).rejects.toMatchObject({ errno: '57014' });
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
