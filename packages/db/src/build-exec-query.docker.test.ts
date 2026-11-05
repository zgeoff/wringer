import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { ssh } from '@wringer/core';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createTestSSHPostgres } from '../test-utils/create-test-ssh-postgres.ts';
import { buildExecQuery } from './build-exec-query.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'build-exec-query');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const postgres = await createTestSSHPostgres(directory);

  onTestFinished(() => {
    postgres.remove();
  });

  const admin = new SQL(postgres.url);

  onTestFinished(() => admin.close());

  const host = ssh({ destination: postgres.destination, binary: postgres.sshBinary });

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
    runWrite: (sql: string, signal: AbortSignal) => {
      const query = buildExecQuery({
        dialect: 'postgres',
        program: ['psql'],
        database: 'shop',
        sql,
        params: [],
        write: true,
      });

      return host.run({ argv: query.argv, stdin: query.stdin, access: 'read-write', signal });
    },
  };
}

test('it never commits a psql write over ssh that ran past its deadline', async () => {
  const ctx = await setupTest();

  await ctx.createNotes();

  const [written] = await Promise.allSettled([
    ctx.runWrite(
      "insert into notes (text) select 'late' from pg_sleep(4)",
      AbortSignal.timeout(1500),
    ),
  ]);

  await waitFor(() => ctx.probeIdle(), { timeoutMs: 8000 });

  const notes = await ctx.readNotes();

  expect({ status: written.status, notes }).toStrictEqual({ status: 'rejected', notes: [] });
});
