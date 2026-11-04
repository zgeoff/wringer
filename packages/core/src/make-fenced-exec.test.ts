import { expect, test } from 'bun:test';
import { local } from './local.ts';
import { makeDriverExec, makeRepoExec } from './make-fenced-exec.ts';

test('#makeRepoExec refuses every exec on a read-only target', () => {
  const exec = makeRepoExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  expect(exec(['ls'])).rejects.toMatchObject({ code: 'read-only', hint: 'Read the logs instead.' });
});

test('#makeRepoExec runs an exec on a read-write target', async () => {
  const exec = makeRepoExec({
    host: local(),
    access: 'read-write',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  const result = await exec(['printf', 'ok']);

  expect(result.stdout).toBe('ok');
});

test("#makeDriverExec runs a driver's read on a read-only target", async () => {
  const exec = makeDriverExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  const result = await exec(['printf', 'ok'], 'read');

  expect(result.stdout).toBe('ok');
});

test("#makeDriverExec refuses a driver's write on a read-only target", () => {
  const exec = makeDriverExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  expect(exec(['touch', 'x'], 'write')).rejects.toMatchObject({ code: 'read-only' });
});
