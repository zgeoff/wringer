import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from './run-process.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

test('it returns the exit code and output of a command, with stdin passed in', async () => {
  const result = await runProcess({
    argv: ['sh', '-c', 'cat; echo oops >&2; exit 3'],
    stdin: 'select 1;',
  });

  expect(result).toStrictEqual({ exitCode: 3, stdout: 'select 1;', stderr: 'oops\n' });
});

test('it finds a relative command in the folder it runs in', async () => {
  const folder = await createTestFolder(import.meta.dir, 'run-process');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await writeFile(join(folder, 'greet'), '#!/bin/sh\necho hello\n', { mode: 0o755 });

  const result = await runProcess({ argv: ['./greet'], cwd: folder });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'hello\n', stderr: '' });
});

test('it fails with an environment error when the folder to run in does not exist', () => {
  expect(
    runProcess({ argv: ['true'], cwd: join(import.meta.dir, 'no-such-folder') }),
  ).rejects.toMatchObject({ code: 'environment' });
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

test('it stops a child the command started when the signal aborts', async () => {
  const startedMs = performance.now();

  const failed = await runProcess({
    argv: ['sh', '-c', 'sleep 3; echo late'],
    signal: AbortSignal.timeout(50),
  }).catch((error: unknown) => error);

  expect({ failed, fast: performance.now() - startedMs < 2000 }).toStrictEqual({
    failed: expect.objectContaining({ code: 'timeout' }),
    fast: true,
  });
});

test('it fails with a timeout error when the signal fired before the command started', () => {
  expect(runProcess({ argv: ['true'], signal: AbortSignal.abort() })).rejects.toMatchObject({
    code: 'timeout',
  });
});

test('it fails with a usage error for an empty argv', () => {
  expect(runProcess({ argv: [] })).rejects.toMatchObject({ code: 'usage' });
});
