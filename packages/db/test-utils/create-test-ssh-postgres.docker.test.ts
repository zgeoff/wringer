import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { waitFor } from '@zgeoff/testing/helpers';
import { $, SQL } from 'bun';
import invariant from 'tiny-invariant';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createTestSSHPostgres } from './create-test-ssh-postgres.ts';

// One stack frees what each test took, in the reverse of the order it took it: the connection,
// then its client, the container, and the folder last.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'create-test-ssh-postgres');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const postgres = await createTestSSHPostgres(directory);

  stack.defer(() => {
    postgres.remove();
  });

  return {
    postgres,
    ssh: (command: string) =>
      Bun.spawnSync([postgres.sshBinary, '-o', 'BatchMode=yes', postgres.destination, command]),
    reserveConnection: async () => {
      const sql = new SQL(postgres.url);

      stack.defer(() => sql.close());

      const connection = await sql.reserve();

      stack.defer(() => {
        connection.release();
      });

      return connection;
    },
  };
}

test('it keeps the database connections open when a process an ssh session left behind exits', async () => {
  const ctx = await setupTest();
  const connection = await ctx.reserveConnection();

  await connection`select 1`;

  ctx.ssh('(sleep 0.3; exit 3) > /dev/null 2>&1 < /dev/null &');

  await waitFor(() => {
    invariant(ctx.ssh('pgrep -f "sleep 0.3"').exitCode !== 0, 'The remote sleep still runs.');
  });

  const rows: { answer: number }[] = await connection`select 2 as answer`;

  expect([...rows]).toStrictEqual([{ answer: 2 }]);
});

test('it removes its SSH host container, sshd and Postgres together, and the data volume', async () => {
  const ctx = await setupTest();

  const volumes =
    await $`docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' ${ctx.postgres.containerID}`.text();

  ctx.postgres.remove();

  const [containers, left] = await Promise.all([
    $`docker ps --all --quiet --no-trunc --filter id=${ctx.postgres.containerID}`.text(),
    $`docker volume ls --quiet`.text(),
  ]);

  const names = volumes.trim().split(' ');

  expect({
    containers: containers.trim(),
    sshAnswers: ctx.ssh('true').exitCode === 0,
    named: names.length,
    left: names.filter((name) => left.split('\n').includes(name)),
  }).toStrictEqual({ containers: '', sshAnswers: false, named: 1, left: [] });
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
