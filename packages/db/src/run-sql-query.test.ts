import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { waitFor } from '@zgeoff/testing/helpers';
import { SQL } from 'bun';
import invariant from 'tiny-invariant';
import { createSQLClients } from './create-sql-clients.ts';
import { runSQLQuery } from './run-sql-query.ts';
import type { SQLClients } from './run-sql-query.ts';
import { createFakePostgres } from './test-utils/create-fake-postgres.ts';

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

  // A server that accepts a connection and never writes to it.
  const stalledSockets = { open: 0, accepted: 0 };

  const stalledServer = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open: () => {
        stalledSockets.open += 1;
        stalledSockets.accepted += 1;
      },
      close: () => {
        stalledSockets.open -= 1;
      },
      data: () => {},
    },
  });

  onTestFinished(() => {
    stalledServer.stop(true);
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
    stalledSockets,
    postgresStatements: postgres.statements,
    refusingPostgresStatements: refusingPostgres.statements,
    runPostgresQuery: (
      sql: string,
      options: { write?: boolean; signal?: AbortSignal; timeLeftMs?: () => number } = {},
    ) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: [],
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
    runOnStalledPostgres: (signal: AbortSignal) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: `postgres://127.0.0.1:${stalledServer.port}/shop`,
          sql: 'select 1',
          params: [],
          write: false,
          signal,
          timeLeftMs: () => 60_000,
        },
        clients,
      ),
    runWithStalledCancel: (sql: string, signal: AbortSignal) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: [],
          write: true,
          signal,
          timeLeftMs: () => 60_000,
        },
        {
          ...clients,

          // The cancel session reaches a server that never answers it.
          openPostgres: (url, sessionName) => {
            const stalledURL = `postgres://127.0.0.1:${stalledServer.port}/shop`;
            const target = sessionName.endsWith('-cancel') ? stalledURL : url;

            return clients.openPostgres(target, sessionName);
          },
        },
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

test('it starts a Postgres write after a second timeout when each round trip takes 100 ms', async () => {
  const ctx = await setupTest();

  const timesLeftMs = [60_000, 59_900, 59_800];

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

  await waitFor(() => {
    invariant(
      ctx.postgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)'),
      'The sleep has not reached postgres yet.',
    );
  });

  controller.abort();

  expect(running).rejects.toMatchObject({ errno: '57014' });
});

test('it reports a refused cancel once, then cancels the Postgres write on a new session', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const running = ctx.runOnRefusingPostgres('select pg_sleep(60)', controller.signal);

  await waitFor(() => {
    invariant(
      ctx.refusingPostgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)'),
      'The sleep has not reached postgres yet.',
    );
  });

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

test('it returns an integer beyond 2^53 as its digits and a small one as a number', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  const result = await ctx.runQuery(
    'select 9007199254740993 as big, -9007199254740993 as low, 5 as small, 1.5 as real',
  );

  expect(result.rows).toStrictEqual([
    { big: '9007199254740993', low: '-9007199254740993', small: 5, real: 1.5 },
  ]);
});

test('it serialises a row with an integer beyond 2^53 as JSON', async () => {
  const ctx = await setupTest();

  ctx.seedNotes([]);

  const result = await ctx.runQuery('select 9223372036854775807 as big');

  expect(JSON.stringify(result.rows)).toBe('[{"big":"9223372036854775807"}]');
});

test('it still counts the rows a write changed', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay', 'ship']);

  const result = await ctx.runQuery("update notes set text = 'done'", { write: true });

  expect(result.rowCount).toBe(2);
});

test('it ends a Postgres query against a server that never answers by its deadline', async () => {
  const ctx = await setupTest();

  const startedAt = performance.now();

  const failure = await ctx
    .runOnStalledPostgres(AbortSignal.timeout(500))
    .catch((error: unknown) => error);

  const elapsedMs = performance.now() - startedAt;

  expect({ failure, onTime: elapsedMs < 1500 }).toStrictEqual({
    failure: expect.objectContaining({ code: 'timeout' }),
    onTime: true,
  });
});

test('it ends a cancel attempt against a server that never answers within its bound', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  // The sleep ends only when the server stops, so the test leaves it running.
  void Promise.allSettled([ctx.runWithStalledCancel('select pg_sleep(60)', controller.signal)]);

  await waitFor(() => {
    invariant(
      ctx.postgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)'),
      'The sleep has not reached postgres yet.',
    );
  });

  controller.abort();

  await waitFor(
    () => {
      invariant(ctx.cancelFailures.length > 0, 'No cancel attempt has ended yet.');
    },
    { timeoutMs: 4000 },
  );

  expect(ctx.cancelFailures).toStrictEqual([expect.stringContaining('timed out')]);
});

test('it closes the socket of a connect that the deadline cut off', async () => {
  const ctx = await setupTest();

  await ctx.runOnStalledPostgres(AbortSignal.timeout(300)).catch(() => null);

  await waitFor(
    () => {
      invariant(ctx.stalledSockets.accepted === 1, 'The connect has not reached the server yet.');
      invariant(ctx.stalledSockets.open === 0, 'A socket of the cut-off connect is still open.');
    },
    { timeoutMs: 1000 },
  );

  expect(ctx.stalledSockets).toStrictEqual({ open: 0, accepted: 1 });
});

test('it starts a second cancel attempt within the attempt and close bounds', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  void Promise.allSettled([ctx.runWithStalledCancel('select pg_sleep(60)', controller.signal)]);

  await waitFor(() => {
    invariant(
      ctx.postgresStatements.some((statement) => statement.sql === 'select pg_sleep(60)'),
      'The sleep has not reached postgres yet.',
    );
  });

  controller.abort();

  // Two bounds of 2 s each end the first attempt and its close.
  await waitFor(
    () => {
      invariant(ctx.stalledSockets.accepted >= 2, 'No second cancel attempt has started yet.');
    },
    { timeoutMs: 4800 },
  );

  expect(ctx.stalledSockets.accepted).toBeGreaterThanOrEqual(2);
});
