import { expect, onTestFinished, test } from 'bun:test';
import { SQL } from 'bun';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createTestPostgres } from '../test-utils/create-test-postgres.ts';
import { createSQLClients } from './create-sql-clients.ts';
import { runSQLQuery } from './run-sql-query.ts';

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

  const clients = createSQLClients();

  // A role that may hold one connection, so a cancel session cannot open while its query runs.
  const clerkURL = new URL(postgres.url);

  clerkURL.username = 'clerk';
  clerkURL.password = 'clerk';

  return {
    createClerk: async () => {
      await admin`create role clerk login password 'clerk' connection limit 1`;
      await admin`grant select, insert on notes to clerk`;
      await admin`grant usage on sequence notes_id_seq to clerk`;
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

      return rows.length > 0 ? true : null;
    },
    runQuery: (
      sql: string,
      options: { write?: boolean; signal?: AbortSignal; params?: readonly unknown[] } = {},
    ) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
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

test('it binds a parameter into a Postgres read', async () => {
  const ctx = await setupTest();
  const result = await ctx.runQuery('select $1::text as label', { params: ['parcel'] });

  expect(result).toStrictEqual({ columns: ['label'], rows: [{ label: 'parcel' }], rowCount: 1 });
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

test('it cancels a running Postgres write when its signal aborts, and the write never commits', async () => {
  const ctx = await setupTest();

  await ctx.createNotes(['pay']);

  const controller = new AbortController();

  const writing = ctx.runQuery("insert into notes (text) select 'late' from pg_sleep(30)", {
    write: true,
    signal: controller.signal,
  });

  await waitFor(() => ctx.probeRunning('pg_sleep(30)'), { timeoutMs: 10_000 });

  controller.abort();

  const [written] = await Promise.allSettled([writing]);
  const notes = await ctx.readNotes();

  expect({ written, notes }).toStrictEqual({
    written: { status: 'rejected', reason: expect.objectContaining({ errno: '57014' }) },
    notes: ['pay'],
  });
});
