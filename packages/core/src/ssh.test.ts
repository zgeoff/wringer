import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createFakeSSH } from '../test-utils/create-fake-ssh.ts';
import { ssh } from './ssh.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'ssh');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { fake: await createFakeSSH(directory) };
}

test('it quotes the argv once per shell layer of a three-layer prefix', async () => {
  const ctx = await setupTest();

  const host = ssh({
    destination: 'app-host',
    binary: ctx.fake.binary,
    prefix: [
      { argv: ['env', 'LAYER=plain'], shell: false },
      { argv: ['sh', '-c'], shell: true },
      { argv: ['sh', '-c'], shell: true },
    ],
  });

  const result = await host.run({
    argv: ['printf', '%s|', "it's", '$HOME', 'a;b', 'two  spaces', '"quoted"', ''],
    access: 'read-write',
  });

  expect(result).toStrictEqual({
    exitCode: 0,
    stdout: `it's|$HOME|a;b|two  spaces|"quoted"||`,
    stderr: '',
  });
});

test('it logs in as the read-only user on a read-only target', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary, readOnlyUser: 'app_ro' });

  await host.run({ argv: ['true'], access: 'read-only' });

  const logins = await readFile(ctx.fake.loginsPath, 'utf8');

  expect(logins).toBe('app_ro@app-host\n');
});

test('it passes stdin through to the remote command', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary });

  const result = await host.run({ argv: ['cat'], access: 'read-write', stdin: 'select 1;' });

  expect(result.stdout).toBe('select 1;');
});

test('it returns the exit code of a remote command that fails', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary });

  const result = await host.run({ argv: ['sh', '-c', 'exit 7'], access: 'read-write' });

  expect(result.exitCode).toBe(7);
});

test('it fails with an environment error when ssh cannot connect', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'unreachable', binary: ctx.fake.binary });

  expect(host.run({ argv: ['true'], access: 'read-write' })).rejects.toMatchObject({
    code: 'environment',
  });
});
