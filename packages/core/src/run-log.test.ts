import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';
import type { RunEvent } from './run-events.ts';
import { appendRunEvent, canMoveRunStatus, findRunStatusMove, parseRunLog } from './run-log.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-log');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const logPath = join(directory, 'events.jsonl');

  return {
    logPath,
    append: (event: RunEvent) =>
      appendRunEvent({
        fs: createNodeStateFileSystem(),
        logPath,
        lockPath: join(directory, 'run.lock'),
        lockTimeoutMs: 2000,
        line: `${JSON.stringify(event)}\n`,
        event,
      }),
    readLog: () => readFile(logPath, 'utf8'),
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

test('#parseRunLog skips a torn last line', () => {
  expect(
    parseRunLog('{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"cra'),
  ).toStrictEqual([{ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' }]);
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
