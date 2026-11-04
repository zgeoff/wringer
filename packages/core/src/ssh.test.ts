import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createFakeSSH } from '../test-utils/create-fake-ssh.ts';
import { probeProcess } from './probe-process.ts';
import { ssh } from './ssh.ts';

// The stack stops the remote process groups before it removes the folder their logs sit in.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'ssh');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const fake = await createFakeSSH(directory);

  stack.defer(() => fake.stopGroups());

  return { directory, fake };
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

test('it stops the remote command and every process it started when the run times out', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary });
  const pidPath = join(ctx.directory, 'remote.pid');

  const running = host.run({
    argv: ['sh', '-c', 'sleep 30 & echo $! > "$0"; wait', pidPath],
    access: 'read-write',
    signal: AbortSignal.timeout(1000),
  });

  const [settled] = await Promise.allSettled([running]);
  const pidText = await readFile(pidPath, 'utf8');

  const pid = Number(pidText);

  const exited = await waitFor(() => {
    invariant(!probeProcess(pid), 'The remote command is still running.');

    return true;
  });

  expect({ status: settled.status, exited }).toStrictEqual({ status: 'rejected', exited: true });
});

test('it stops a remote command whose process group starts only after the run timed out', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'slow-setsid', binary: ctx.fake.binary });
  const latePath = join(ctx.directory, 'late.txt');

  await Promise.allSettled([
    host.run({
      argv: ['sh', '-c', 'sleep 3; echo late > "$0"', latePath],
      access: 'read-write',
      signal: AbortSignal.timeout(150),
    }),
  ]);

  const leaderText = await waitFor(() => readFile(ctx.fake.setsidPIDPath, 'utf8'));

  const leader = Number(leaderText);

  await waitFor(
    () => {
      invariant(!probeProcess(leader), 'The remote process group is still running.');
    },
    { timeoutMs: 8000 },
  );

  const late = await readFile(latePath, 'utf8').catch(() => null);

  expect(late).toBeNull();
});

test('it stops a background process that outlived the remote command when the run times out', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary });
  const pidPath = join(ctx.directory, 'remote.pid');

  const running = host.run({
    argv: ['sh', '-c', 'sleep 30 & echo $! > "$0"', pidPath],
    access: 'read-write',
    signal: AbortSignal.timeout(1000),
  });

  const [settled] = await Promise.allSettled([running]);
  const pidText = await readFile(pidPath, 'utf8');

  const pid = Number(pidText);

  const exited = await waitFor(() => {
    invariant(!probeProcess(pid), 'The remote command is still running.');

    return true;
  });

  expect({ status: settled.status, exited }).toStrictEqual({ status: 'rejected', exited: true });
});

test('it kills a remote command that ignores SIGINT and SIGTERM when the run times out', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary });
  const pidPath = join(ctx.directory, 'remote.pid');

  const running = host.run({
    argv: ['sh', '-c', 'trap "" INT TERM; sleep 30 & echo $! > "$0"; wait', pidPath],
    access: 'read-write',
    signal: AbortSignal.timeout(500),
  });

  await Promise.allSettled([running]);

  const pidText = await readFile(pidPath, 'utf8');

  const pid = Number(pidText);

  const exited = await waitFor(() => {
    invariant(!probeProcess(pid), 'The remote command is still running.');

    return true;
  });

  expect(exited).toBe(true);
});

test('it names a failed stop connection in the error of a run that timed out', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'drops-stops', binary: ctx.fake.binary });

  // The fake runs the remote side here and holds ssh's pipes until it ends, so it ends soon.
  const running = host.run({
    argv: ['sleep', '2'],
    access: 'read-write',
    signal: AbortSignal.timeout(300),
  });

  const [settled] = await Promise.allSettled([running]);

  expect(settled).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'timeout',
      message: expect.stringContaining(
        'The remote command may still run: the stop exited with code 255',
      ),
    }),
  });
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

test('it follows a remote command on a terminal as the read-only user, line by line', async () => {
  const ctx = await setupTest();

  const host = ssh({ destination: 'app-host', binary: ctx.fake.binary, readOnlyUser: 'app_ro' });
  const lines: string[] = [];

  const exitCode = await host.follow({
    argv: ['printf', '%s\n', "it's up", 'second'],
    access: 'read-only',
    signal: new AbortController().signal,
    onLine: (line) => {
      lines.push(line);
    },
  });

  const logins = await readFile(ctx.fake.loginsPath, 'utf8');

  expect({ exitCode, lines, logins }).toStrictEqual({
    exitCode: 0,
    lines: ["it's up", 'second'],
    logins: 'app_ro@app-host tty\n',
  });
});
