import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRunEvent, canMoveRunStatus, findRunStatusMove } from './append-run-event.ts';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';
import { parseRunLog } from './parse-run-log.ts';
import type { RunEvent } from './run-events.ts';
import { createLockHolder } from './test-utils/create-lock-holder.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';
import { WringerError } from './wringer-error.ts';

// The stack kills each process that holds the lock before it removes the folder the lock sits in.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'append-run-event');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const logPath = join(directory, 'events.jsonl');
  const lockPath = join(directory, 'locks', 'run.lock');

  return {
    logPath,
    append: (event: RunEvent, lockTimeoutMs = 2000) =>
      appendRunEvent({
        fs: createNodeStateFileSystem(),
        logPath,
        lockPath,
        lockTimeoutMs,
        line: `${JSON.stringify(event)}\n`,
        event,
        refuse: null,
      }),
    appendRefused: (event: RunEvent, refusal: WringerError) =>
      appendRunEvent({
        fs: createNodeStateFileSystem(),
        logPath,
        lockPath,
        lockTimeoutMs: 2000,
        line: `${JSON.stringify(event)}\n`,
        event,
        refuse: () => refusal,
      }),
    readLog: () => readFile(logPath, 'utf8'),

    holdInOtherProcess: async () => {
      const holder = await createLockHolder(lockPath);

      stack.defer(holder.kill);

      return holder;
    },
  };
}

test('#appendRunEvent writes the first event of a log that does not exist', async () => {
  const ctx = await setupTest();
  const wrote = await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' });

  expect({ wrote, log: await ctx.readLog() }).toStrictEqual({
    wrote: true,
    log: '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n',
  });
});

test('#appendRunEvent refuses with an environment error while another process holds the run lock', async () => {
  const ctx = await setupTest();
  const holding = await ctx.holdInOtherProcess();

  const [appended] = await Promise.allSettled([
    ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' }, 50),
  ]);

  expect({ held: holding.held, appended }).toStrictEqual({
    held: true,
    appended: { status: 'rejected', reason: expect.objectContaining({ code: 'environment' }) },
  });
});

test('#appendRunEvent writes once the process that held the run lock is killed', async () => {
  const ctx = await setupTest();
  const holding = await ctx.holdInOtherProcess();

  await holding.kill();

  const wrote = await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' });

  expect({ held: holding.held, wrote }).toStrictEqual({ held: true, wrote: true });
});

test('#appendRunEvent cuts a torn last line before it writes', async () => {
  const ctx = await setupTest();

  await writeFile(
    ctx.logPath,
    '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"cra',
  );

  await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:05.000Z' });

  const log = await ctx.readLog();

  expect(log).toBe(
    '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"run-ended","at":"2026-11-04T10:00:05.000Z"}\n',
  );
});

test('#appendRunEvent cuts a torn last line of characters that take more than one byte each', async () => {
  const ctx = await setupTest();

  await writeFile(
    ctx.logPath,
    '{"type":"crashed","at":"2026-11-04T10:00:00.000Z","reason":"café"}\n{"type":"cra',
  );

  await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:05.000Z' });

  const log = await ctx.readLog();

  expect(log).toBe(
    '{"type":"crashed","at":"2026-11-04T10:00:00.000Z","reason":"café"}\n{"type":"run-ended","at":"2026-11-04T10:00:05.000Z"}\n',
  );
});

test('#appendRunEvent keeps a log that ends on a whole line as it was before the new event', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n');

  await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:05.000Z' });

  const log = await ctx.readLog();

  expect(log).toBe(
    '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"run-ended","at":"2026-11-04T10:00:05.000Z"}\n',
  );
});

test('#appendRunEvent rejects with the refusal its check returns and writes nothing', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n');

  const refusal = new WringerError('doctor-required', { message: 'The doctor ran again.' });

  const [settled] = await Promise.allSettled([
    ctx.appendRefused({ type: 'run-ended', at: '2026-11-04T10:00:05.000Z' }, refusal),
  ]);

  expect({ settled, log: await ctx.readLog() }).toStrictEqual({
    settled: { status: 'rejected', reason: refusal },
    log: '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n',
  });
});

test('#appendRunEvent refuses a move that the status table does not allow', async () => {
  const ctx = await setupTest();

  await ctx.append({
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f00d',
  });

  await ctx.append({ type: 'run-ended', at: '2026-11-04T10:00:01.000Z' });

  const wrote = await ctx.append({
    type: 'crashed',
    at: '2026-11-04T10:00:02.000Z',
    reason: 'the launch exited',
  });

  const log = await ctx.readLog();

  expect({ wrote, types: parseRunLog(log).map((event) => event.type) }).toStrictEqual({
    wrote: false,
    types: ['run-started', 'run-ended'],
  });
});

test.each([
  ['starting', 'running', true],
  ['starting', 'crashed', true],
  ['starting', 'ended', true],
  ['running', 'crashed', true],
  ['running', 'ended', true],
  ['crashed', 'ended', true],
  ['running', 'starting', false],
  ['crashed', 'running', false],
  ['ended', 'running', false],
  ['ended', 'crashed', false],
] as const)('#canMoveRunStatus answers a move from %s to %s with %p', (from, to, allowed) => {
  expect(canMoveRunStatus(from, to)).toBe(allowed);
});

test.each([
  ['run-ready', 'running'],
  ['launch-ready', null],
  ['crashed', 'crashed'],
  ['run-ended', 'ended'],
  ['doctor-passed', null],
  ['envelope', null],
] as const)('#findRunStatusMove maps the %s event to %p', (eventType, status) => {
  expect(findRunStatusMove(eventType)).toBe(status);
});
