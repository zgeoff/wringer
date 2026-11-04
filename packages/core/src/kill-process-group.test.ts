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
