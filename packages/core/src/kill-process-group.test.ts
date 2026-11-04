import { expect, test } from 'bun:test';
import { killProcessGroup } from './kill-process-group.ts';

test('it kills a detached child and the processes it started', async () => {
  const child = Bun.spawn(['sh', '-c', 'sleep 30 & wait'], { detached: true, stdout: 'pipe' });

  killProcessGroup(child.pid);

  // The pipe closes only once the `sleep` that shares it has died too.
  const output = await new Response(child.stdout).text();

  const exitCode = await child.exited;

  expect({ output, exitCode, signal: child.signalCode }).toStrictEqual({
    output: '',
    exitCode: 137,
    signal: 'SIGKILL',
  });
});

test('it does nothing for a group that is already gone', async () => {
  const child = Bun.spawn(['true'], { detached: true });

  await child.exited;

  expect(() => {
    killProcessGroup(child.pid);
  }).not.toThrow();
});
