import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { ssh } from '@wringer/core';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createTestSSHPostgres } from '../test-utils/create-test-ssh-postgres.ts';
import { buildExecQuery } from './build-exec-query.ts';
import { parseExecResult } from './parse-exec-result.ts';

// One stack frees what each test took, in the reverse of the order it took it: the client, the
// container, then the folder.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'build-exec-query');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const postgres = await createTestSSHPostgres(directory);

  stack.defer(() => {
    postgres.remove();
  });

  const admin = new SQL(postgres.url);

  stack.defer(() => admin.close());

  const host = ssh({ destination: postgres.destination, binary: postgres.sshBinary });

  // A transport that takes 1 s to start the client, as a container runtime can.
  const slowHost = ssh({
    destination: postgres.destination,
    binary: postgres.sshBinary,
    prefix: [{ argv: ['sh', '-c', 'sleep 1; exec "$0" "$@"'], shell: false }],
  });

  return {
    createNotes: () => admin`create table notes (id serial primary key, text text not null)`,
    readNotes: async () => {
      const rows: { text: string }[] = await admin`select text from notes order by id`;

      return rows.map((row) => row.text);
    },
    probeIdle: async () => {
      const rows: unknown[] = await admin`
        select pid from pg_stat_activity
        where state = 'active' and pid <> pg_backend_pid() and query like '%pg_sleep%'`;

      return rows.length === 0 ? true : null;
    },
    runWrite: (sql: string, signal: AbortSignal, deadlineAtMs: number) => {
      const query = buildExecQuery({
        dialect: 'postgres',
        program: ['psql'],
        database: 'shop',
        sql,
        params: [],
        write: true,
        deadlineAtMs,
      });

      return host.run({ argv: query.argv, stdin: query.stdin, access: 'read-write', signal });
    },
    runRead: async (sql: string) => {
      const query = buildExecQuery({
        dialect: 'postgres',
        program: ['psql'],
        database: 'shop',
        sql,
        params: [],
        write: false,
        deadlineAtMs: Date.now() + 60_000,
      });

      const result = await host.run({
        argv: query.argv,
        stdin: query.stdin,
        access: 'read-only',
      });

      return parseExecResult({ result, output: query.output, write: false });
    },
    runSlowStartWrite: (sql: string, deadlineAtMs: number) => {
      const query = buildExecQuery({
        dialect: 'postgres',
        program: ['psql'],
        database: 'shop',
        sql,
        params: [],
        write: true,
        deadlineAtMs,
      });

      return slowHost.run({ argv: query.argv, stdin: query.stdin, access: 'read-write' });
    },
  };
}

test('it names the columns of a psql read over ssh that returns no rows', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const result = await ctx.runRead('select id, text as label from notes where id < 0');

  expect(result).toStrictEqual({ columns: ['id', 'label'], rows: [], rowCount: 0 });
});

test('it never commits a psql write over ssh that ran past its deadline', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const [written] = await Promise.allSettled([
    ctx.runWrite(
      "insert into notes (text) select 'late' from pg_sleep(4)",
      AbortSignal.timeout(1500),
      Date.now() + 60_000,
    ),
  ]);

  await waitFor(() => ctx.probeIdle(), { timeoutMs: 8000 });

  const notes = await ctx.readNotes();

  expect({ status: written.status, notes }).toStrictEqual({ status: 'rejected', notes: [] });
});

test('it has postgres stop a psql write at its deadline when no abort reaches psql', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const result = await ctx.runWrite(
    "insert into notes (text) select 'late' from pg_sleep(4)",
    new AbortController().signal,
    Date.now() + 1500,
  );

  const notes = await ctx.readNotes();

  // psql exits 3 when `ON_ERROR_STOP` ends the script at a failed statement.
  expect({ exitCode: result.exitCode, stderr: result.stderr, notes }).toStrictEqual({
    exitCode: 3,
    stderr: expect.stringContaining('canceling statement due to statement timeout'),
    notes: [],
  });
});

test('it has postgres stop a psql write at a deadline its transport startup used up in part', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const result = await ctx.runSlowStartWrite(
    "insert into notes (text) select 'late' from pg_sleep(1)",
    Date.now() + 1500,
  );

  const notes = await ctx.readNotes();

  expect({ exitCode: result.exitCode, stderr: result.stderr, notes }).toStrictEqual({
    exitCode: 3,
    stderr: expect.stringContaining('canceling statement due to statement timeout'),
    notes: [],
  });
});

test('it has postgres refuse a psql write whose deadline passed while its transport started', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const result = await ctx.runWrite(
    "insert into notes (text) values ('late')",
    new AbortController().signal,
    Date.now() - 1,
  );

  const notes = await ctx.readNotes();

  expect({ exitCode: result.exitCode, stderr: result.stderr, notes }).toStrictEqual({
    exitCode: 3,
    stderr: expect.stringContaining("The command's deadline passed before the statement started."),
    notes: [],
  });
});
