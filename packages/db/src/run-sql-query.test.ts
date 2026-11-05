import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createFakePostgres } from '../test-utils/create-fake-postgres.ts';
import { createSQLClients } from './create-sql-clients.ts';
import { runSQLQuery } from './run-sql-query.ts';
import type { SQLClients } from './run-sql-query.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-sql-query');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');
  const postgres = createFakePostgres();

  onTestFinished(() => {
    postgres.stop();
  });

  // This server refuses the first session a cancel opens.
  const refusingPostgres = createFakePostgres({ cancelRefusals: 1 });

  onTestFinished(() => {
    refusingPostgres.stop();
  });

  const cancelFailures: string[] = [];
  const waits: number[] = [];

  // The cancel loop's waits end at once, so a retry takes no real time.
  const clients: SQLClients = {
    ...createSQLClients(),
    reportCancelFailure: (message) => {
      cancelFailures.push(message);
    },
    wait: (delayMs) => {
      waits.push(delayMs);

      return Promise.resolve();
    },
  };

  // The fake records a statement at its Parse message, which Bun.SQL skips for a statement it has
  // prepared already, so this client prepares none and a repeated statement shows each time.
  const unpreparedClients: SQLClients = {
    ...clients,
    openPostgres: (url, sessionName) =>
      new SQL(url, { max: 1, prepare: false, connection: { application_name: sessionName } }),
  };

  return {
    directory,
    file,
    cancelFailures,
    waits,
    postgresStatements: postgres.statements,
    refusingPostgresStatements: refusingPostgres.statements,
    runPostgresQuery: (
      sql: string,
      options: {
        params?: readonly unknown[];
        write?: boolean;
        signal?: AbortSignal;
        timeLeftMs?: () => number;
      } = {},
    ) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: options.params ?? [],
          write: options.write ?? false,
          signal: options.signal ?? new AbortController().signal,
          timeLeftMs: options.timeLeftMs ?? (() => 60_000),
        },
        clients,
      ),
    runUnpreparedPostgresWrite: (sql: string, timeLeftMs: () => number) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: [],
          write: true,
          signal: new AbortController().signal,
          timeLeftMs,
        },
        unpreparedClients,
      ),
    runOnRefusingPostgres: (sql: string, signal: AbortSignal) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: refusingPostgres.url,
          sql,
          params: [],
          write: true,
          signal,
          timeLeftMs: () => 60_000,
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
          timeLeftMs: () => 60_000,
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
    { protocol: 'extended', sql: "select set_config('statement_timeout', $1, false)" },
    { protocol: 'simple', sql: 'BEGIN read only' },
    { protocol: 'extended', sql: 'COMMIT; DELETE FROM notes' },
    { protocol: 'simple', sql: 'COMMIT' },
  ]);
});

test('it sends a Postgres write with no parameters as one extended-protocol statement', async () => {
  const ctx = await setupTest();

  await ctx.runPostgresQuery('DELETE FROM notes; DROP TABLE notes', { write: true });

  expect(ctx.postgresStatements).toStrictEqual([
    { protocol: 'extended', sql: "select set_config('statement_timeout', $1, false)" },
    { protocol: 'extended', sql: 'DELETE FROM notes; DROP TABLE notes' },
  ]);
});

test('it refuses a Postgres write that has no time left once its connection is up, and sends nothing', async () => {
  const ctx = await setupTest();

  const failure = await ctx
    .runPostgresQuery("insert into notes (text) values ('late')", {
      write: true,
      timeLeftMs: () => 0,
    })
    .catch((error: unknown) => error);

  expect({ failure, statements: ctx.postgresStatements }).toStrictEqual({
    failure: expect.objectContaining({ code: 'timeout' }),
    statements: [],
  });
});

test('it refuses a Postgres write whose deadline passed while its timeout was set, and sends only the timeout', async () => {
  const ctx = await setupTest();

  const timesLeftMs = [60_000, 0];

  const failure = await ctx
    .runPostgresQuery("insert into notes (text) values ('late')", {
      write: true,
      timeLeftMs: () => timesLeftMs.shift() ?? 0,
    })
    .catch((error: unknown) => error);

  expect({ failure, statements: ctx.postgresStatements }).toStrictEqual({
    failure: expect.objectContaining({ code: 'timeout' }),
    statements: [
      { protocol: 'extended', sql: "select set_config('statement_timeout', $1, false)" },
    ],
  });
});

test('it sets the Postgres timeout again from the time left after a slow round trip', async () => {
  const ctx = await setupTest();

  const timesLeftMs = [60_000, 1000, 1000];

  await ctx.runUnpreparedPostgresWrite(
    "insert into notes (text) values ('late')",
    () => timesLeftMs.shift() ?? 0,
  );

  expect(ctx.postgresStatements).toStrictEqual([
    { protocol: 'extended', sql: "select set_config('statement_timeout', $1, false)" },
    { protocol: 'extended', sql: "select set_config('statement_timeout', $1, false)" },
    { protocol: 'extended', sql: "insert into notes (text) values ('late')" },
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

test('it reports a refused cancel once, then cancels the Postgres write on a new session', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const running = ctx.runOnRefusingPostgres('select pg_sleep(60)', controller.signal);

  await waitFor(() =>
    ctx.refusingPostgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)')
      ? true
      : null,
  );

  controller.abort();

  const failure = await running.catch((error: unknown) => error);

  expect({ failure, reports: ctx.cancelFailures, waits: ctx.waits }).toStrictEqual({
    failure: expect.objectContaining({ errno: '57014' }),
    reports: [expect.stringContaining('sorry, too many clients already')],
    waits: [100, 100],
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
