import { expect, onTestFinished, test } from 'bun:test';
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { createFileState } from './create-file-state.ts';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';
import { lateFailureEventSchema, runEventSchema, runIDSchema } from './run-event.ts';

async function setupTest() {
  const stateDir = await createTestFolder(import.meta.dir, 'create-file-state');

  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));

  const state = createFileState({
    stateDir,
    lockTimeoutMs: 2000,
    fs: createNodeStateFileSystem(),
  });

  // A second command on the same state folder that gives up on a held lock at once.
  const impatientState = createFileState({
    stateDir,
    lockTimeoutMs: 50,
    fs: createNodeStateFileSystem(),
  });

  return {
    stateDir,
    state,
    impatientState,
    holdRunLock: async (runID: string, work: () => Promise<void>) => {
      await mkdir(state.paths.locks, { recursive: true });

      return withFileLock(join(state.paths.locks, `run-${runID}.lock`), work);
    },
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

test('#withTargetLock refuses a second command on a target another command holds', async () => {
  const ctx = await setupTest();

  const tryLocal = () => ctx.impatientState.withTargetLock('local', () => Promise.resolve('ran'));

  const [second] = await ctx.state.withTargetLock('local', () => Promise.allSettled([tryLocal()]));

  expect(second).toMatchObject({ status: 'rejected', reason: { code: 'environment' } });
});

test('#withTargetLock runs a command on one target while another command holds a second', async () => {
  const ctx = await setupTest();

  const second = await ctx.state.withTargetLock('local', () =>
    ctx.impatientState.withTargetLock('prod', () => Promise.resolve('ran')),
  );

  expect(second).toBe('ran');
});

test('it keeps the run that the saved cursors belong to', async () => {
  const ctx = await setupTest();

  await ctx.state.writePointers((current) => ({
    ...current,
    cursors: { app: 120 },
    cursorsRun: runIDSchema.parse('mf3k2a-7q1z'),
  }));

  const pointers = await ctx.state.readPointers();

  expect(pointers).toStrictEqual({
    currentRun: {},
    cursors: { app: 120 },
    cursorsRun: 'mf3k2a-7q1z',
  });
});

test('it never interleaves events that many writers append at once', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');
  const reason = 'x'.repeat(16 * 1024);

  await Promise.all(
    Array.from({ length: 20 }, () =>
      ctx.state.appendEvent(runID, { type: 'crashed', at: '2026-11-04T10:00:01.000Z', reason }),
    ),
  );

  const log = await ctx.readLog('mf3k2a-7q1z');

  const lines = log.trimEnd().split('\n');

  expect(lines).toHaveLength(20);
  expect(lines).toSatisfyAll((line: string) => runEventSchema.safeParse(JSON.parse(line)).success);
});

test('#appendLateFailure keeps each late failure on its own line of the state folder log', async () => {
  const ctx = await setupTest();

  await Promise.all([
    ctx.state.appendLateFailure({
      type: 'late-failure',
      at: '2026-11-05T10:00:00.000Z',
      command: 'recount',
      code: 'internal',
      message: 'The recount lost its place.',
    }),
    ctx.state.appendLateFailure({
      type: 'late-failure',
      at: '2026-11-05T10:00:01.000Z',
      command: 'tally',
      code: 'environment',
      message: 'The tally sheet was missing.',
    }),
  ]);

  const lines = await readFile(ctx.state.paths.lateFailures, 'utf8');

  const commands = lines
    .trimEnd()
    .split('\n')
    .map((line) => lateFailureEventSchema.parse(JSON.parse(line)).command);

  expect(commands.toSorted()).toStrictEqual(['recount', 'tally']);
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

test('it starts the next event on a line of its own after a torn last line', async () => {
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

  await ctx.state.appendEvent(runID, { type: 'run-ended', at: '2026-11-04T10:00:02.000Z' });

  const events = await ctx.state.readRunEvents(runID);

  expect(events).toStrictEqual([
    {
      type: 'run-started',
      at: '2026-11-04T10:00:00.000Z',
      target: 'local',
      mode: 'attach',
      fingerprint: 'f00d',
    },
    { type: 'run-ended', at: '2026-11-04T10:00:02.000Z' },
  ]);
});

test('it leaves out a crash that arrives after the run ended', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'attach',
    fingerprint: 'f00d',
  });

  await ctx.state.appendEvent(runID, { type: 'run-ended', at: '2026-11-04T10:00:02.000Z' });

  await ctx.state.appendEvent(runID, {
    type: 'crashed',
    at: '2026-11-04T10:00:03.000Z',
    reason: 'the launch exited',
  });

  const events = await ctx.state.readRunEvents(runID);

  expect(events.map((event) => event.type)).toStrictEqual(['run-started', 'run-ended']);
});

test('it rejects a read of a log that is not a file', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await mkdir(buildRunPaths(ctx.stateDir, runID).log, { recursive: true });

  expect(ctx.state.readRunEvents(runID)).rejects.toMatchObject({ code: 'EISDIR' });
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

test('it reads the log for a manifest only once the run lock is free', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f00d',
  });

  let written: Promise<void> | undefined;

  await ctx.holdRunLock('mf3k2a-7q1z', async () => {
    written = ctx.state.writeManifest(runID);

    await appendFile(
      buildRunPaths(ctx.stateDir, runID).log,
      '{"type":"run-ended","at":"2026-11-04T10:00:05.000Z"}\n',
    );
  });

  await written;

  const manifest = await ctx.readManifest('mf3k2a-7q1z');

  expect(JSON.parse(manifest)).toHaveProperty('status', 'ended');
});

test('it reads each stream file size of a run as its cursor', async () => {
  const ctx = await setupTest();

  const streams = buildRunPaths(ctx.stateDir, runIDSchema.parse('mf3k2a-7q1z')).streams;

  await mkdir(streams, { recursive: true });
  await writeFile(join(streams, 'orders.ndjson'), '{"line":"paid"}\n');
  await writeFile(join(streams, 'notes.txt'), 'kale\n');

  const cursors = await ctx.state.readCursors(runIDSchema.parse('mf3k2a-7q1z'));

  expect(cursors).toStrictEqual({ orders: 16 });
});

test('it reads no cursors for a run whose streams have not started', async () => {
  const ctx = await setupTest();
  const cursors = await ctx.state.readCursors(runIDSchema.parse('mf3k2a-7q1z'));

  expect(cursors).toStrictEqual({});
});

test('it rejects a cursor read when the streams path is a file', async () => {
  const ctx = await setupTest();

  const runPaths = buildRunPaths(ctx.stateDir, runIDSchema.parse('mf3k2a-7q1z'));

  await mkdir(runPaths.directory, { recursive: true });
  await writeFile(runPaths.streams, 'kale\n');

  expect(ctx.state.readCursors(runIDSchema.parse('mf3k2a-7q1z'))).rejects.toMatchObject({
    code: 'ENOTDIR',
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

test('it keeps a secret in a file of mode 0600 and reads it back', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });

  const info = await stat(buildRunPaths(ctx.stateDir, runID).secrets);
  const secrets = await ctx.state.readSecrets(runID);

  expect({ mode: info.mode & 0o777, secrets }).toStrictEqual({
    mode: 0o600,
    secrets: [{ name: 'notes.session', value: 'planted-session-value' }],
  });
});

test('it appends a secret the file already holds once', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await Promise.all([
    ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' }),
    ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' }),
  ]);

  const secrets = await ctx.state.readSecrets(runID);

  expect(secrets).toStrictEqual([{ name: 'notes.session', value: 'planted-session-value' }]);
});

test('it reads no secrets for a run with no file, and after the file is removed', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  const before = await ctx.state.readSecrets(runID);

  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });
  await ctx.state.removeSecrets(runID);

  const after = await ctx.state.readSecrets(runID);

  expect({ before, after }).toStrictEqual({ before: [], after: [] });
});

test.each([
  { status: 'ended', last: { type: 'run-ended', at: '2026-11-04T10:00:01.000Z' } },
  {
    status: 'crashed',
    last: { type: 'crashed', at: '2026-11-04T10:00:01.000Z', reason: 'the app exited' },
  },
])('it writes no secret for a run that has $status', async (row) => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendEvent(runID, runEventSchema.parse(row.last));
  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });

  const secrets = await ctx.state.readSecrets(runID);

  expect(secrets).toStrictEqual([]);
});

test('it skips a torn line of the secrets file', async () => {
  const ctx = await setupTest();

  const runID = runIDSchema.parse('mf3k2a-7q1z');

  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });

  await appendFile(buildRunPaths(ctx.stateDir, runID).secrets, '{"name":"torn","val');

  const secrets = await ctx.state.readSecrets(runID);

  expect(secrets).toStrictEqual([{ name: 'notes.session', value: 'planted-session-value' }]);
});
