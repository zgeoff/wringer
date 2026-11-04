import { expect, onTestFinished, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRunPaths } from './build-state-paths.ts';
import { createFileState } from './create-file-state.ts';
import { runEventSchema, runIDSchema } from './run-events.ts';

async function setupTest() {
  const stateDir = await mkdtemp(join(import.meta.dir, '.test-create-file-state-'));

  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));

  return {
    stateDir,
    state: createFileState({ stateDir, lockTimeoutMs: 2000 }),
    readLog: (runID: string) =>
      readFile(buildRunPaths(stateDir, runIDSchema.parse(runID)).log, 'utf8'),
    readManifest: (runID: string) =>
      readFile(buildRunPaths(stateDir, runIDSchema.parse(runID)).manifest, 'utf8'),
  };
}

test('it reads empty pointers before any command wrote state', async () => {
  const ctx = await setupTest();
  const pointers = await ctx.state.readPointers();

  expect(pointers).toStrictEqual({ currentRun: {}, cursors: {} });
});

test('it keeps both changes when two commands write the pointers at once', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await Promise.all([
    ctx.state.writePointers((current) => ({ ...current, feature: 'checkout' })),
    ctx.state.writePointers((current) => ({
      ...current,
      currentRun: { ...current.currentRun, local: runID },
    })),
  ]);

  const pointers = await ctx.state.readPointers();

  expect(pointers).toStrictEqual({
    currentRun: { local: 'mf3k2a-7q1z' },
    feature: 'checkout',
    cursors: {},
  });
});

test('it never interleaves events that many writers append at once', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');
  const reason = 'x'.repeat(16 * 1024);

  await Promise.all(
    Array.from({ length: 200 }, () =>
      ctx.state.appendEvent(runID, { type: 'crashed', at: '2026-11-04T10:00:01.000Z', reason }),
    ),
  );

  const log = await ctx.readLog('mf3k2a-7q1z');

  const lines = log.trimEnd().split('\n');

  expect(lines).toHaveLength(200);
  expect(lines).toSatisfyAll((line: string) => runEventSchema.safeParse(JSON.parse(line)).success);
});

test('it refuses an event over the size cap with an internal error', async () => {
  const ctx = await setupTest();

  expect(
    ctx.state.appendEvent(runIDSchema.parse('mf3k2a-7q1z'), {
      type: 'crashed',
      at: '2026-11-04T10:00:01.000Z',
      reason: 'x'.repeat(70 * 1024),
    }),
  ).rejects.toMatchObject({ code: 'internal' });
});

test('it reads the events before a torn last line of the log', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'attach',
    fingerprint: 'f00d',
  });

  await appendFile(buildRunPaths(ctx.stateDir, runID).log, '{"type":"launch-re');

  const events = await ctx.state.readRunEvents(runID);

  expect(events).toStrictEqual([
    {
      type: 'run-started',
      at: '2026-11-04T10:00:00.000Z',
      target: 'local',
      mode: 'attach',
      fingerprint: 'f00d',
    },
  ]);
});

test('it writes a manifest of the run from its log', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f00d',
  });

  await ctx.state.appendEvent(runID, {
    type: 'doctor-passed',
    at: '2026-11-04T10:00:01.000Z',
    results: [{ name: 'health', status: 'passed', durationMs: 3, code: null, message: null }],
  });

  await ctx.state.writeManifest(runID);

  const manifest = await ctx.readManifest('mf3k2a-7q1z');

  expect(JSON.parse(manifest)).toStrictEqual({
    target: 'local',
    instance: 'mf3k2a-7q1z',
    mode: 'launch',
    fingerprint: 'f00d',
    status: 'starting',
    doctor: {
      state: 'passed',
      results: [{ name: 'health', status: 'passed', durationMs: 3, code: null, message: null }],
    },
    startedAt: '2026-11-04T10:00:00.000Z',
    endedAt: null,
  });
});

test('it lists the runs that have a log folder', async () => {
  const ctx = await setupTest();

  await ctx.state.appendEvent(runIDSchema.parse('mf3k2a-7q1z'), {
    type: 'run-ended',
    at: '2026-11-04T10:00:00.000Z',
  });

  const runs = await ctx.state.listRuns();

  expect(runs).toStrictEqual(['mf3k2a-7q1z']);
});
