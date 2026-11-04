import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { SQL } from 'bun';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createTestPostgres } from '../test-utils/create-test-postgres.ts';
import { runSQLQuery } from './run-sql-query.ts';
import type { SqliteMode } from './run-sql-query.ts';

async function setupTest() {
  const postgres = await createTestPostgres();

  onTestFinished(() => {
    postgres.remove();
  });

  const admin = new SQL(postgres.url);

  onTestFinished(() => admin.close());

  const clients = {
    openSqlite: (path: string, mode: SqliteMode) => new Database(path, { [mode]: true }),
    openPostgres: (url: string, sessionName: string) =>
      new SQL(url, { connection: { application_name: sessionName } }),
  };

  return {
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
    runQuery: (sql: string, options: { write?: boolean; signal?: AbortSignal } = {}) =>
      runSQLQuery(
        {
          adapter: 'postgres',
          url: postgres.url,
          sql,
          params: [],
          write: options.write ?? false,
          signal: options.signal ?? new AbortController().signal,
        },
        clients,
      ),
  };
}

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
