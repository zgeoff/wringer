import { expect, test } from 'bun:test';
import { local } from './local.ts';
import { makeRepoExec } from './make-repo-exec.ts';

test('it refuses every exec on a read-only target', () => {
  const exec = makeRepoExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  expect(exec(['ls'])).rejects.toMatchObject({ code: 'read-only', hint: 'Read the logs instead.' });
});

test('it runs an exec on a read-write target', async () => {
  const exec = makeRepoExec({
    host: local(),
    access: 'read-write',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  const result = await exec(['printf', 'ok']);

  expect(result.stdout).toBe('ok');
});
