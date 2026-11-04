import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { callSupervisor } from './call-supervisor.ts';
import { createRepoState } from './create-repo-state.ts';
import { createWringer } from './create-wringer.ts';
import { defineDriver } from './define-driver.ts';
import { local } from './local.ts';
import { readLaunchHost } from './read-launch-host.ts';
import { buildStopEvents, runSupervisor } from './run-supervisor.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import { WringerError } from './wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-supervisor');

  const stopGate = Promise.withResolvers<undefined>();
  const stopCalls: string[] = [];
  const supervisors: Promise<void>[] = [];

  const teardown = new AbortController();

  // One cleanup stops every supervisor the test started, then removes the folder they write into.
  onTestFinished(async () => {
    stopGate.resolve(undefined);
    teardown.abort();

    await Promise.allSettled(supervisors);

    await rm(directory, { recursive: true, force: true });
  });

  const leaky = defineDriver({
    name: 'leaky',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {
      store: {
        start: () =>
          Promise.resolve({
            methods: {},
            stop: async () => {
              stopCalls.push('store');

              await stopGate.promise;

              throw new WringerError('environment', { message: 'The store kept its lock.' });
            },
          }),
      },
    },
    client: () => ({}),
  });

  const wringer = createWringer({ name: 'shop' })
    .use(leaky({}))
    .target('box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { leaky: () => ({}) },
    })
    .build();

  const state = createRepoState(directory, wringer.stateDir);

  return {
    stopCalls,

    // Reads the run as it stands the moment the stop call returns.
    stopThenRead: async (socket: string, runID: string) => {
      await callSupervisor({
        socket,
        request: { service: supervisorServiceName, method: 'stop', args: null },
        signal: AbortSignal.timeout(5000),
      });

      return state.readRun(runID);
    },
    openStopGate: () => {
      stopGate.resolve(undefined);
    },
    readRun: (runID: string) => state.readRun(runID),
    runFolder: (runID: string) => buildRunPaths(state.paths.root, runID).directory,
    seedRun: (runID: string) =>
      state.appendEvent(runID, {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'box',
        mode: 'attach',
        fingerprint: 'empty',
      }),
    runSupervisor: (runID: string, signal: AbortSignal = teardown.signal) => {
      const supervising = runSupervisor({
        wringer,
        launchHost: readLaunchHost(),
        state,
        runID,
        target: 'box',
        readyTimeoutMs: 5000,
        now: () => new Date(),
        signal: AbortSignal.any([signal, teardown.signal]),
      });

      supervisors.push(supervising);

      return supervising;
    },
  };
}

test.each([
  { crashReason: null, failures: [], event: { type: 'run-ended' } },
  {
    crashReason: 'the app exited with code 3',
    failures: [],
    event: { type: 'crashed', reason: 'the app exited with code 3' },
  },
  {
    crashReason: null,
    failures: ['leaky/store: locked'],
    event: { type: 'crashed', reason: 'cleanup failed for leaky/store: locked' },
  },
  {
    crashReason: 'the app exited with code 3',
    failures: ['leaky/store: locked'],
    event: {
      type: 'crashed',
      reason: 'the app exited with code 3; cleanup failed for leaky/store: locked',
    },
  },
])(
  '#buildStopEvents ends the run with $event.type for crash $crashReason and failures $failures',
  (row) => {
    expect(
      buildStopEvents({
        crashReason: row.crashReason,
        failures: row.failures,
        at: '2026-11-04T10:00:00.000Z',
      }),
    ).toStrictEqual([{ ...row.event, at: '2026-11-04T10:00:00.000Z' }]);
  },
);

test('#runSupervisor answers a second stop only once the first has ended the run', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  const socket = ready.supervisor?.socket ?? '';
  const first = ctx.stopThenRead(socket, 'shelf-run');

  await waitFor(() => (ctx.stopCalls.length > 0 ? true : null));

  const second = ctx.stopThenRead(socket, 'shelf-run');

  ctx.openStopGate();

  const [afterFirst, afterSecond] = await Promise.all([first, second, supervising]);

  expect([afterFirst?.status, afterSecond?.status]).toStrictEqual(['crashed', 'crashed']);
});

test('#runSupervisor ends and frees its socket when its final log write fails', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  await rm(join(ctx.runFolder('shelf-run'), 'manifest.json'));
  await mkdir(join(ctx.runFolder('shelf-run'), 'manifest.json', 'blocked'), { recursive: true });

  ctx.openStopGate();

  const socket = ready.supervisor?.socket ?? '';

  const [stopFailure] = await Promise.all([
    ctx.stopThenRead(socket, 'shelf-run').catch((error: unknown) => error),
    supervising,
  ]);

  expect({
    stopFailure,
    socketLeft: await Bun.file(socket).exists(),
  }).toStrictEqual({ stopFailure: expect.any(WringerError), socketLeft: false });
});

test('#runSupervisor ends and closes its socket when its first log write fails', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  await rm(join(ctx.runFolder('shelf-run'), 'log.ndjson'));
  await mkdir(join(ctx.runFolder('shelf-run'), 'log.ndjson', 'blocked'), { recursive: true });

  expect(ctx.runSupervisor('shelf-run')).resolves.toBeUndefined();
});

test('#runSupervisor starts nothing and ends the run when its stop signal fired already', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');
  await ctx.runSupervisor('shelf-run', AbortSignal.abort());

  const view = await ctx.readRun('shelf-run');

  expect({ reason: view?.crashReason, stopCalls: ctx.stopCalls }).toStrictEqual({
    reason: 'the supervisor was signalled to stop',
    stopCalls: [],
  });
});

test('#runSupervisor records a service that failed to stop in the crash reason', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  ctx.openStopGate();

  const [ended] = await Promise.all([
    ctx.stopThenRead(ready.supervisor?.socket ?? '', 'shelf-run'),
    supervising,
  ]);

  expect(ended?.crashReason).toBe('cleanup failed for leaky/store: The store kept its lock.');
});
