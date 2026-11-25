import { expect, test } from 'bun:test';
import { createTempDir } from '@zgeoff/testing/fs';
import { createDockerSqlite3 } from './create-docker-sqlite3.ts';

async function setupTest() {
  const directory = createTempDir('create-docker-sqlite3').path;

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
