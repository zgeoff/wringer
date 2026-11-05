import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';
import { killProcessGroup } from './kill-process-group.ts';
import type { RunEvent } from './run-events.ts';
import {
  appendRunEvent,
  canMoveRunStatus,
  findRunStatusMove,
  parseRunLog,
  pickLogAppend,
} from './run-log.ts';

// The stack kills each process that holds the lock before it removes the folder the lock sits in.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'run-log');

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
      }),
    readLog: () => readFile(logPath, 'utf8'),

    // A process group of its own takes the lock and keeps it until the group is killed.
    holdInOtherProcess: async () => {
      await mkdir(dirname(lockPath), { recursive: true });

      const script = [
        "import { withFileLock } from '@zgeoff/std/with-file-lock';",
        `await withFileLock(${JSON.stringify(lockPath)}, async () => {`,
        "  console.log('held');",
        '  await Bun.sleep(60_000);',
        '});',
      ].join('\n');

      const holder = Bun.spawn([process.execPath, '-e', script], {
        cwd: join(import.meta.dir, '..'),
        stdout: 'pipe',
        detached: true,
      });

      stack.defer(async () => {
        killProcessGroup(holder.pid);

        await holder.exited;
      });

      const first = await holder.stdout.getReader().read();

      return {
        held: !first.done,
        kill: async () => {
          killProcessGroup(holder.pid);

          await holder.exited;
        },
      };
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

test('#pickLogAppend cuts a torn last line to the bytes of the whole lines', () => {
  const plan = pickLogAppend('{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"cr', {
    type: 'run-ended',
    at: '2026-11-04T10:00:05.000Z',
  });

  expect(plan).toStrictEqual({ truncateBytes: 53, append: true });
});

test('#pickLogAppend leaves a log that ends on a whole line uncut', () => {
  const plan = pickLogAppend('', { type: 'run-ended', at: '2026-11-04T10:00:05.000Z' });

  expect(plan).toStrictEqual({ truncateBytes: null, append: true });
});

test('#pickLogAppend drops a crash that arrives after the run ended', () => {
  const plan = pickLogAppend(
    '{"type":"run-started","at":"2026-11-04T10:00:00.000Z","target":"local","mode":"launch","fingerprint":"f00d"}\n{"type":"run-ended","at":"2026-11-04T10:00:01.000Z"}\n',
    { type: 'crashed', at: '2026-11-04T10:00:02.000Z', reason: 'the launch exited' },
  );

  expect(plan).toStrictEqual({ truncateBytes: null, append: false });
});

test('#parseRunLog skips a torn last line', () => {
  expect(
    parseRunLog('{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"cra'),
  ).toStrictEqual([{ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' }]);
});

test.each([
  ['a line that is no JSON', '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\nnot json\n'],
  [
    'a line that is no run event',
    '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"lunch"}\n',
  ],
])('#parseRunLog refuses %s with an environment error', (_name, text) => {
  expect(() => parseRunLog(text)).toThrow(expect.objectContaining({ code: 'environment' }));
});

test('#parseRunLog skips a whole last event that has no newline yet', () => {
  expect(
    parseRunLog(
      '{"type":"launch-ready","at":"2026-11-04T10:00:00.000Z","endpoints":{}}\n{"type":"run-ended","at":"2026-11-04T10:01:00.000Z"}',
    ),
  ).toStrictEqual([{ type: 'launch-ready', at: '2026-11-04T10:00:00.000Z', endpoints: {} }]);
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
  ['launch-ready', 'running'],
  ['crashed', 'crashed'],
  ['run-ended', 'ended'],
  ['doctor-passed', null],
  ['envelope', null],
] as const)('#findRunStatusMove maps the %s event to %p', (eventType, status) => {
  expect(findRunStatusMove(eventType)).toBe(status);
});
