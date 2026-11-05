import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createDockerSqlite3 } from './create-docker-sqlite3.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-docker-sqlite3');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const sqlite3 = await createDockerSqlite3(directory);

  return { sqlite3 };
}

test('it runs the sqlite3 shell on the statement it reads on stdin', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.sqlite3, '-json', ':memory:'], {
    stdin: new TextEncoder().encode('select 7 as shelf;'),
  });

  expect({ exitCode: result.exitCode, stdout: result.stdout.toString() }).toStrictEqual({
    exitCode: 0,
    stdout: '[{"shelf":7}]\n',
  });
});
