import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createFakeSSH } from './create-fake-ssh.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-fake-ssh');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, fake: await createFakeSSH(directory) };
}

test('it runs the command string through a shell and logs the login', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([
    ctx.fake.binary,
    '-o',
    'BatchMode=yes',
    '-l',
    'app_ro',
    '--',
    'db-host',
    "printf '%s|' 'a b' c",
  ]);

  expect({
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    logins: await readFile(ctx.fake.loginsPath, 'utf8'),
  }).toStrictEqual({ exitCode: 0, stdout: 'a b|c|', logins: 'app_ro@db-host\n' });
});

test('it exits 255 for the unreachable destination', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'unreachable', 'true']);

  expect(result.exitCode).toBe(255);
});

test('it refuses more than one command word, as a caller that skips quoting would send', async () => {
  const ctx = await setupTest();

  const result = Bun.spawnSync([ctx.fake.binary, '--', 'db-host', 'printf', 'x']);

  expect(result.exitCode).toBe(2);
});
