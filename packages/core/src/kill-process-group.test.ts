import { expect, onTestFinished, test } from 'bun:test';
import { killProcessGroup } from './kill-process-group.ts';

test('it kills a detached child and the processes it started', async () => {
  const child = Bun.spawn(['sh', '-c', 'sleep 30 & echo ready; wait'], {
    detached: true,
    stdout: 'pipe',
  });

  onTestFinished(() => {
    killProcessGroup(child.pid);
  });

  const reader = child.stdout.getReader();

  const ready = await reader.read();

  killProcessGroup(child.pid);

  // The pipe closes only once the `sleep` that shares it has died too.
  const rest = await reader.read();
  const exitCode = await child.exited;

  expect({
    ready: new TextDecoder().decode(ready.value),
    restDone: rest.done,
    exitCode,
    signal: child.signalCode,
  }).toStrictEqual({ ready: 'ready\n', restDone: true, exitCode: 137, signal: 'SIGKILL' });
});

test('it sends the signal it is given to the whole group', async () => {
  const child = Bun.spawn(['sh', '-c', 'sleep 30 & echo ready; wait'], {
    detached: true,
    stdout: 'pipe',
  });

  onTestFinished(() => {
    killProcessGroup(child.pid);
  });

  const reader = child.stdout.getReader();

  await reader.read();

  killProcessGroup(child.pid, 'SIGTERM');

  const rest = await reader.read();
  const exitCode = await child.exited;

  expect({ restDone: rest.done, exitCode, signal: child.signalCode }).toStrictEqual({
    restDone: true,
    exitCode: 143,
    signal: 'SIGTERM',
  });
});

test('it does nothing for a group that is already gone', async () => {
  const child = Bun.spawn(['true'], { detached: true });

  await child.exited;

  expect(() => {
    killProcessGroup(child.pid);
  }).not.toThrow();
});

test.skipIf(process.platform !== 'darwin')(
  'it does nothing for a group whose only process exited and is not yet reaped',
  async () => {
    // The parent puts its child in a group of its own, waits for SIGCHLD without reaping, prints
    // the child's PID, and stays alive, so the child stays a zombie that leads its own group.
    const parent = Bun.spawn(
      [
        'perl',
        '-e',
        String.raw`$| = 1; my $exited = 0; $SIG{CHLD} = sub { $exited = 1 }; my $pid = fork; if ($pid == 0) { setpgrp(0, 0); exit 0 } setpgrp($pid, $pid); select(undef, undef, undef, 0.01) until $exited; print "$pid\n"; sleep 30`,
      ],
      { stdout: 'pipe' },
    );

    onTestFinished(() => {
      parent.kill('SIGKILL');
    });

    const line = await parent.stdout.getReader().read();

    const zombiePID = Number(new TextDecoder().decode(line.value));

    expect(() => {
      killProcessGroup(zombiePID);
    }).not.toThrow();
  },
);

test.each([
  ['darwin', 'EPERM'],
  ['darwin', 'ESRCH'],
  ['linux', 'ESRCH'],
] as const)('it treats %s %s as a group that is gone', (platform, code) => {
  const kill = () => {
    throw Object.assign(new Error(code), { code });
  };

  expect(() => {
    killProcessGroup(1234, 'SIGKILL', { kill, platform });
  }).not.toThrow();
});

test.each([
  ['linux', 'EPERM'],
  ['darwin', 'EINVAL'],
] as const)('it throws %s %s', (platform, code) => {
  const kill = () => {
    throw Object.assign(new Error(code), { code });
  };

  expect(() => {
    killProcessGroup(1234, 'SIGKILL', { kill, platform });
  }).toThrowWithMessage(Error, code);
});
