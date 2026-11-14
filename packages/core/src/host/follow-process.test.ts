import { expect, mock, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { followProcess } from './follow-process.ts';
import { probeProcess } from './probe-process.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'follow-process');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    pidPath: join(directory, 'follow.pid'),
    readPID: async (path: string) => {
      const text = await readFile(path, 'utf8');

      return Number(text);
    },
    followProcess,
  };
}

test('it hands each stdout line to onLine and resolves with the exit code', async () => {
  const ctx = await setupTest();

  const lines: string[] = [];

  const followed = await ctx.followProcess({
    argv: ['sh', '-c', String.raw`printf "first\nsecond\n"; exit 3`],
    signal: new AbortController().signal,
    onLine: (line) => {
      lines.push(line);
    },
  });

  expect({ followed, lines }).toStrictEqual({
    followed: { exitCode: 3, stderr: '' },
    lines: ['first', 'second'],
  });
});

test('it keeps only the last 4096 characters of the command stderr', async () => {
  const ctx = await setupTest();

  const followed = await ctx.followProcess({
    argv: ['sh', '-c', String.raw`head -c 5000 /dev/zero | tr "\0" a >&2; printf "%s" "-last" >&2`],
    signal: new AbortController().signal,
    onLine: mock<(line: string) => void>(),
  });

  expect(followed.stderr).toBe(`${'a'.repeat(4091)}-last`);
});

test('it stops a command that never ends when the signal fires', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const onLine = mock<(line: string) => void>(() => {
    controller.abort();
  });

  const followed = ctx.followProcess({
    argv: ['sh', '-c', 'echo up; exec sleep 60'],
    signal: controller.signal,
    onLine,
  });

  expect(followed).resolves.toMatchObject({ exitCode: expect.any(Number) });
});

test('it stops a child the command started when the signal fires', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const onLine = mock<(line: string) => void>(() => {
    controller.abort();
  });

  const startedMs = performance.now();

  await ctx.followProcess({
    argv: ['sh', '-c', 'echo up; sleep 30 & wait'],
    signal: controller.signal,
    onLine,
  });

  expect(performance.now() - startedMs).toBeLessThan(5000);
});

test('it stops a command that closed its stdout and runs on when the signal fires', async () => {
  const ctx = await setupTest();

  const followed = ctx.followProcess({
    argv: ['sh', '-c', 'exec 1>&-; exec sleep 60'],
    signal: AbortSignal.timeout(200),
    onLine: mock<(line: string) => void>(),
  });

  expect(followed).resolves.toMatchObject({ exitCode: expect.any(Number) });
});

test('it ends when the command exits, though a child it left running holds stdout', async () => {
  const ctx = await setupTest();

  const startedMs = performance.now();

  await ctx.followProcess({
    argv: ['sh', '-c', 'echo up; sleep 30 &'],
    signal: new AbortController().signal,
    onLine: mock<(line: string) => void>(),
  });

  expect(performance.now() - startedMs).toBeLessThan(5000);
});

test('it stops a child the command left running when the command exits', async () => {
  const ctx = await setupTest();

  await ctx.followProcess({
    argv: ['sh', '-c', 'sleep 60 >/dev/null 2>&1 & echo $! > "$0"', ctx.pidPath],
    signal: new AbortController().signal,
    onLine: mock<(line: string) => void>(),
  });

  const pid = await ctx.readPID(ctx.pidPath);

  // The killed child lingers until init reaps it, so the test waits for it to go.
  const exited = await waitFor(() => {
    invariant(!probeProcess(pid), 'The command is still running.');

    return true;
  });

  expect(exited).toBeTrue();
});

test('it stops the command and rethrows when onLine throws', async () => {
  const ctx = await setupTest();

  const onLine = mock<(line: string) => void>(() => {
    throw new Error('the shelf is full');
  });

  const followed = ctx.followProcess({
    argv: ['sh', '-c', 'echo $$ > "$0"; echo up; exec sleep 60', ctx.pidPath],
    signal: new AbortController().signal,
    onLine,
  });

  const [settled] = await Promise.allSettled([followed]);
  const pid = await ctx.readPID(ctx.pidPath);

  expect({ status: settled.status, alive: probeProcess(pid) }).toStrictEqual({
    status: 'rejected',
    alive: false,
  });
});

test('it rejects a command that is not on the PATH', async () => {
  const ctx = await setupTest();

  expect(
    ctx.followProcess({
      argv: ['wringer-no-such-command'],
      signal: new AbortController().signal,
      onLine: mock<(line: string) => void>(),
    }),
  ).rejects.toMatchObject({ code: 'environment' });
});
