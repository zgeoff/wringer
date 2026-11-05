import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { SQL } from 'bun';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createTestSSHPostgres } from './create-test-ssh-postgres.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-test-ssh-postgres');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const postgres = await createTestSSHPostgres(directory);

  onTestFinished(() => {
    postgres.remove();
  });

  return {
    postgres,
    ssh: (command: string) =>
      Bun.spawnSync([postgres.sshBinary, '-o', 'BatchMode=yes', postgres.destination, command]),
  };
}

test('it keeps the database connections open when a process an ssh session left behind exits', async () => {
  const ctx = await setupTest();

  const sql = new SQL(ctx.postgres.url);

  onTestFinished(() => sql.close());

  const connection = await sql.reserve();

  onTestFinished(() => {
    connection.release();
  });

  await connection`select 1`;

  ctx.ssh('(sleep 0.3; exit 3) > /dev/null 2>&1 < /dev/null &');

  await waitFor(() => (ctx.ssh('pgrep -f "sleep 0.3"').exitCode === 0 ? null : true));

  const rows: { answer: number }[] = await connection`select 2 as answer`;

  expect([...rows]).toStrictEqual([{ answer: 2 }]);
});

test('it runs psql over ssh on the host that holds the database', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([
    ctx.postgres.sshBinary,
    '-o',
    'BatchMode=yes',
    ctx.postgres.destination,
    'psql -t -A -d shop -c "select current_user"',
  ]);

  expect({ exitCode: result.exitCode, stdout: result.stdout.toString() }).toStrictEqual({
    exitCode: 0,
    stdout: 'shop\n',
  });
});
