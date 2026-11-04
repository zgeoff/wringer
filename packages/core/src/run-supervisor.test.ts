import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { callSupervisor } from './call-supervisor.ts';
import { createRepoState } from './create-repo-state.ts';
import { createWringer } from './create-wringer.ts';
import { defineDriver } from './define-driver.ts';
import { local } from './local.ts';
import { buildStopEvents, runSupervisor } from './run-supervisor.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import { WringerError } from './wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-supervisor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const stopGate = Promise.withResolvers<undefined>();
  const stopCalls: string[] = [];

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
    seedRun: (runID: string) =>
      state.appendEvent(runID, {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'box',
        mode: 'attach',
        fingerprint: 'empty',
      }),
    runSupervisor: (runID: string) =>
      runSupervisor({
        wringer,
        state,
        runID,
        target: 'box',
        readyTimeoutMs: 5000,
        now: () => new Date(),
      }),
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
