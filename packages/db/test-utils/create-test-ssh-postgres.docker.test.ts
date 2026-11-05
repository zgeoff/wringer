import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createTestSSHPostgres } from './create-test-ssh-postgres.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-test-ssh-postgres');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const postgres = await createTestSSHPostgres(directory);

  onTestFinished(() => {
    postgres.remove();
  });

  return { postgres };
}

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
