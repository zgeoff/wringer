import { expect, test } from 'bun:test';
import { runProcess } from './run-process.ts';

test('it returns the exit code and output of a command, with stdin passed in', async () => {
  const result = await runProcess({
    argv: ['sh', '-c', 'cat; echo oops >&2; exit 3'],
    stdin: 'select 1;',
  });

  expect(result).toStrictEqual({ exitCode: 3, stdout: 'select 1;', stderr: 'oops\n' });
});

test('it fails with an environment error for a command that is not on the PATH', () => {
  expect(runProcess({ argv: ['wringer-no-such-command'] })).rejects.toMatchObject({
    code: 'environment',
  });
});

test('it fails with a timeout error when the signal aborts the command', () => {
  expect(
    runProcess({ argv: ['sleep', '5'], signal: AbortSignal.timeout(50) }),
  ).rejects.toMatchObject({ code: 'timeout' });
});

test('it fails with a timeout error when the signal fired before the command started', () => {
  expect(runProcess({ argv: ['true'], signal: AbortSignal.abort() })).rejects.toMatchObject({
    code: 'timeout',
  });
});

test('it fails with a usage error for an empty argv', () => {
  expect(runProcess({ argv: [] })).rejects.toMatchObject({ code: 'usage' });
});
