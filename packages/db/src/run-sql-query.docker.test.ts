import { expect, onTestFinished, test } from 'bun:test';
import { waitFor } from '@zgeoff/testing/helpers';
import { SQL } from 'bun';
import invariant from 'tiny-invariant';
import { createSQLClients } from './create-sql-clients.ts';
import { runSQLQuery } from './run-sql-query.ts';
import { createTestPostgres } from './test-utils/create-test-postgres.ts';

// One stack frees what each test took, in the reverse of the order it took it: the client, then
// the container.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const postgres = await createTestPostgres();

  stack.defer(() => {
    postgres.remove();
  });

  const admin = new SQL(postgres.url);

  stack.defer(() => admin.close());

  const cancelFailures: string[] = [];

  const clients = {
    ...createSQLClients(),
    reportCancelFailure: (message: string) => {
      cancelFailures.push(message);
    },
  };

  // A role that may hold one connection, so a cancel session cannot open while its query runs.
  const clerkURL = new URL(postgres.url);

  clerkURL.username = 'clerk';
  clerkURL.password = 'clerk';

  return {
    cancelFailures,
    createClerk: async () => {
      await admin`create role clerk login password 'clerk' connection limit 1`;
      await admin`grant select, insert on notes to clerk`;
      await admin`grant usage on sequence notes_id_seq to clerk`;
    },
    allowSecondClerkSession: async () => {
      await admin`alter role clerk connection limit 2`;
    },
    runAsClerk: (sql: string, signal: AbortSignal, timeLeftMs: number) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: clerkURL.href,
          sql,
          params: [],
          write: true,
          signal,
          timeLeftMs: () => timeLeftMs,
        },
        clients,
      ),
    createNotes: (texts: readonly string[]) =>
      admin.begin(async (transaction) => {
        await transaction`create table notes (id serial primary key, text text not null)`;

        for (const text of texts) {
          await transaction`insert into notes (text) values (${text})`;
        }
      }),
    readNotes: async () => {
      const rows: { text: string }[] = await admin`select text from notes order by id`;

      return rows.map((row) => row.text);
    },
    probeRunning: async (fragment: string) => {
      const rows: unknown[] = await admin`
        select pid from pg_stat_activity
        where state = 'active' and pid <> pg_backend_pid() and query like ${`%${fragment}%`}`;

      return rows.length > 0;
    },
    runQuery: (
      sql: string,
      options: {
        write?: boolean;
        signal?: AbortSignal;
        params?: readonly unknown[];
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
  };
}

test('it reads Postgres rows with their columns and their count', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay', 'ship']);

  const result = await ctx.runQuery("select id, text from notes where text = 'ship'");

  expect(result).toStrictEqual({
    columns: ['id', 'text'],
    rows: [{ id: 2, text: 'ship' }],
    rowCount: 1,
  });
});

test.each([
  { name: 'returns no rows', sql: 'select 1 as "2", 2 as "1" where false', rowCount: 0 },
  { name: 'returns a row', sql: 'select 1 as "2", 2 as "1"', rowCount: 1 },
])(
  'it keeps the order of Postgres columns named like numbers in a read that $name',
  async (row) => {
    const ctx = await setupTest();
    const result = await ctx.runQuery(row.sql);

    expect({ columns: result.columns, rowCount: result.rowCount }).toStrictEqual({
      columns: ['2', '1'],
      rowCount: row.rowCount,
    });
  },
);

test('it names the columns of a Postgres read with a parameter that returns no rows', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const result = await ctx.runQuery('select id, text as label from notes where text = $1;', {
    params: ['ship'],
  });

  expect(result).toStrictEqual({ columns: ['id', 'label'], rows: [], rowCount: 0 });
});

test('it names the columns of a Postgres read that returns no rows and ends in a comment', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const result = await ctx.runQuery('select id, text from notes where 1 = 0; -- done');

  expect(result).toStrictEqual({ columns: ['id', 'text'], rows: [], rowCount: 0 });
});

test('it binds a parameter into a Postgres read', async () => {
  const ctx = await setupTest();
  const result = await ctx.runQuery('select $1::text as label', { params: ['parcel'] });

  expect(result).toStrictEqual({ columns: ['label'], rows: [{ label: 'parcel' }], rowCount: 1 });
});

test('it runs a Postgres read under a timeout no longer than the time left after a slow round trip', async () => {
  const ctx = await setupTest();

  const timesLeftMs = [60_000, 59_000, 58_900];

  const result = await ctx.runQuery("select current_setting('statement_timeout') as timeout", {
    timeLeftMs: () => timesLeftMs.shift() ?? 0,
  });

  expect(result.rows).toStrictEqual([{ timeout: '57s' }]);
});

test('it refuses to start a Postgres read when each round trip grows past the time left', async () => {
  const ctx = await setupTest();

  const timesLeftMs = [60_000, 59_000, 56_000, 40_000];

  const failure = await ctx
    .runQuery("select current_setting('statement_timeout') as timeout", {
      timeLeftMs: () => timesLeftMs.shift() ?? 0,
    })
    .catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: 'timeout' });
});

test('it counts the rows a Postgres write changed', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay', 'ship', 'pack']);

  const result = await ctx.runQuery("delete from notes where text <> 'pay'", { write: true });

  expect(result).toStrictEqual({ columns: [], rows: [], rowCount: 2 });
});

test('it refuses a Postgres read that holds a second statement, and changes nothing', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const failure = await ctx.runQuery('COMMIT; DELETE FROM notes').catch((error: unknown) => error);
  const notes = await ctx.readNotes();

  expect({ failure, notes }).toStrictEqual({
    failure: expect.objectContaining({ errno: '42601' }),
    notes: ['pay'],
  });
});

test('it refuses a Postgres read that writes, in its read-only transaction', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const failure = await ctx.runQuery('DELETE FROM notes').catch((error: unknown) => error);
  const notes = await ctx.readNotes();

  expect({ failure, notes }).toStrictEqual({
    failure: expect.objectContaining({ errno: '25006' }),
    notes: ['pay'],
  });
});

test('it never sends a Postgres write whose signal aborts while its connection opens', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const controller = new AbortController();

  const writing = ctx.runQuery("insert into notes (text) values ('late')", {
    write: true,
    signal: controller.signal,
  });

  controller.abort();

  const [written] = await Promise.allSettled([writing]);
  const notes = await ctx.readNotes();

  expect({ written, notes }).toStrictEqual({
    written: { status: 'rejected', reason: expect.objectContaining({ code: 'timeout' }) },
    notes: ['pay'],
  });
});

test('it stops a Postgres write at its deadline when the role cannot open a cancel session', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);
  await ctx.createClerk();

  const [written] = await Promise.allSettled([
    ctx.runAsClerk(
      "insert into notes (text) select 'late' from pg_sleep(4)",
      AbortSignal.timeout(1500),
      1500,
    ),
  ]);

  const notes = await ctx.readNotes();

  expect({ written, notes }).toStrictEqual({
    written: { status: 'rejected', reason: expect.objectContaining({ errno: '57014' }) },
    notes: ['pay'],
  });
});

test('it reports a refused cancel session once, then cancels the Postgres write once a session opens', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);
  await ctx.createClerk();

  const controller = new AbortController();

  const writing = ctx.runAsClerk(
    "insert into notes (text) select 'late' from pg_sleep(30)",
    controller.signal,
    60_000,
  );

  await waitFor(
    async () => {
      const running = await ctx.probeRunning('pg_sleep(30)');

      invariant(running, 'Postgres has not started the sleep yet.');
    },
    { timeoutMs: 10_000 },
  );

  controller.abort();

  await waitFor(() => {
    invariant(ctx.cancelFailures.length > 0, 'Postgres has not refused a cancel session yet.');
  });

  await ctx.allowSecondClerkSession();

  const [written] = await Promise.allSettled([writing]);
  const notes = await ctx.readNotes();

  expect({ written, notes, reports: ctx.cancelFailures }).toStrictEqual({
    written: { status: 'rejected', reason: expect.objectContaining({ errno: '57014' }) },
    notes: ['pay'],
    reports: [expect.stringContaining('too many connections for role "clerk"')],
  });
});

test('it cancels a running Postgres write when its signal aborts, and the write never commits', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const controller = new AbortController();

  const writing = ctx.runQuery("insert into notes (text) select 'late' from pg_sleep(30)", {
    write: true,
    signal: controller.signal,
  });

  await waitFor(
    async () => {
      const running = await ctx.probeRunning('pg_sleep(30)');

      invariant(running, 'Postgres has not started the sleep yet.');
    },
    { timeoutMs: 10_000 },
  );

  controller.abort();

  const [written] = await Promise.allSettled([writing]);
  const notes = await ctx.readNotes();

  expect({ written, notes }).toStrictEqual({
    written: { status: 'rejected', reason: expect.objectContaining({ errno: '57014' }) },
    notes: ['pay'],
  });
});
