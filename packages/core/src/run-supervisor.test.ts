import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  const startGate = Promise.withResolvers<undefined>();
  const stopCalls: string[] = [];
  const reports: string[] = [];
  const supervisors: Promise<void>[] = [];

  const teardown = new AbortController();

  // One cleanup stops every supervisor the test started, then removes the folder they write into.
  onTestFinished(async () => {
    stopGate.resolve(undefined);
    startGate.resolve(undefined);
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

  // Its service comes up only once the test opens the start gate, whatever the abort says.
  const tardy = defineDriver({
    name: 'tardy',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {
      queue: {
        start: async () => {
          await startGate.promise;

          return {
            methods: {},
            stop: () => {
              stopCalls.push('queue');

              return Promise.resolve();
            },
          };
        },
      },
    },
    client: () => ({}),
  });

  // Its service's stop runs a command through the exec the service started with.
  const tidy = defineDriver({
    name: 'tidy',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {
      shelf: {
        start: (ctx) =>
          Promise.resolve({
            methods: {},
            stop: async () => {
              const result = await ctx.exec(['true'], 'read');

              stopCalls.push(`shelf exited ${result.exitCode}`);
            },
          }),
      },
    },
    client: () => ({}),
  });

  // Its service's stop throws before it returns a promise.
  const brittle = defineDriver({
    name: 'brittle',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {
      till: {
        start: () =>
          Promise.resolve({
            methods: {},
            stop: () => {
              throw new WringerError('environment', { message: 'The till jammed.' });
            },
          }),
      },
    },
    client: () => ({}),
  });

  // Its service's stop records the last line of the app's log.
  const scribe = defineDriver({
    name: 'scribe',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {
      ledger: {
        start: (ctx) =>
          Promise.resolve({
            methods: {},
            stop: async () => {
              const log = await readFile(ctx.run.childLog('app').path, 'utf8');

              stopCalls.push(`ledger read ${log.trimEnd().split('\n').at(-1) ?? ''}`);
            },
          }),
      },
    },
    client: () => ({}),
  });

  const wringer = createWringer({ name: 'shop' })
    .use(leaky({}))
    .use(tardy({}))
    .use(tidy({}))
    .use(brittle({}))
    .use(scribe({}))
    .target('box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { leaky: () => ({}) },
    })
    .target('late', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { tardy: () => ({}) },
    })
    .target('tidy-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { tidy: () => ({}) },
    })
    .target('brittle-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { brittle: () => ({}), tidy: () => ({}) },
    })
    .target('scribe-box', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: () => ({
        command: [
          'sh',
          '-c',
          `trap 'echo closing; exit 0' TERM; echo '{"port":4300}'; while :; do sleep 0.05; done`,
        ],
        ready: (line) => (line['port'] === 4300 ? { web: 'http://127.0.0.1:4300' } : null),
      }),
      drivers: { scribe: () => ({}) },
    })
    .build();

  const state = createRepoState(directory, wringer.stateDir);
  const appendEvent = spyOn(state, 'appendEvent');
  const launchHost = readLaunchHost();
  const removeDirectory = spyOn(launchHost, 'removeDirectory');
  const listenSocket = spyOn(launchHost, 'listenSupervisorSocket');

  return {
    stopCalls,
    reports,

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
    callStatus: (socket: string) =>
      callSupervisor({
        socket,
        request: { service: supervisorServiceName, method: 'status', args: null },
        signal: AbortSignal.timeout(5000),
      }),
    openStartGate: () => {
      startGate.resolve(undefined);
    },
    readRun: (runID: string) => state.readRun(runID),
    runFolder: (runID: string) => buildRunPaths(state.paths.root, runID).directory,
    appendEvent,
    removeDirectory,
    listenSocket,
    seedRun: (runID: string) =>
      state.appendEvent(runID, {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'box',
        mode: 'attach',
        fingerprint: 'empty',
      }),
    runSupervisor: (runID: string, signal: AbortSignal = teardown.signal, target = 'box') => {
      const supervising = runSupervisor({
        wringer,
        launchHost,
        state,
        runID,
        target,
        readyTimeoutMs: 5000,
        stopWaitMs: 1000,
        now: () => new Date(),
        reportError: (message) => {
          reports.push(message);
        },
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

test('#runSupervisor reports a failed final log write when a signal stopped the run', async () => {
  const ctx = await setupTest();

  const signal = new AbortController();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', signal.signal);

  await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  await rm(join(ctx.runFolder('shelf-run'), 'manifest.json'));
  await mkdir(join(ctx.runFolder('shelf-run'), 'manifest.json', 'blocked'), { recursive: true });

  ctx.openStopGate();
  signal.abort();

  await supervising;

  expect(ctx.reports).toSatisfyAny((report: string) =>
    report.startsWith("The run's final log write failed:"),
  );
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

  expect(stopFailure).toBeInstanceOf(WringerError);
  expect(readdir(dirname(socket))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('#runSupervisor ends and closes its socket when its first log write fails', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  await rm(join(ctx.runFolder('shelf-run'), 'log.ndjson'));
  await mkdir(join(ctx.runFolder('shelf-run'), 'log.ndjson', 'blocked'), { recursive: true });

  await ctx.runSupervisor('shelf-run');

  const [socket = ''] = ctx.appendEvent.mock.calls.flatMap(([, event]) =>
    event.type === 'supervisor-ready' ? [event.socket] : [],
  );

  expect(readdir(dirname(socket))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(ctx.callStatus(socket)).rejects.toThrow();
});

test('#runSupervisor answers a call to a method every object inherits with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  void ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  const called = callSupervisor({
    socket: ready.supervisor?.socket ?? '',
    request: { service: 'leaky/store', method: 'constructor', args: null },
    signal: AbortSignal.timeout(5000),
  });

  expect(called).rejects.toMatchObject({ code: 'usage' });
});

test('#runSupervisor ends the run as crashed and still stops the other services when a stop throws at once', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', undefined, 'brittle-box');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  const [ended] = await Promise.all([
    ctx.stopThenRead(ready.supervisor?.socket ?? '', 'shelf-run'),
    supervising,
  ]);

  expect({ status: ended?.status, stopCalls: ctx.stopCalls }).toStrictEqual({
    status: 'crashed',
    stopCalls: ['shelf exited 0'],
  });
});

test('#runSupervisor stops the app before the services, so a service sees what the app logged as it stopped', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', undefined, 'scribe-box');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  await Promise.all([ctx.stopThenRead(ready.supervisor?.socket ?? '', 'shelf-run'), supervising]);

  expect(ctx.stopCalls).toStrictEqual(['ledger read closing']);
});

test('#runSupervisor lets a service run a command from its stop', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', undefined, 'tidy-box');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  const [ended] = await Promise.all([
    ctx.stopThenRead(ready.supervisor?.socket ?? '', 'shelf-run'),
    supervising,
  ]);

  expect({ status: ended?.status, stopCalls: ctx.stopCalls }).toStrictEqual({
    status: 'ended',
    stopCalls: ['shelf exited 0'],
  });
});

test('#runSupervisor removes its socket folder through the launch host once the run ends', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  ctx.openStopGate();

  const socket = ready.supervisor?.socket ?? '';

  await Promise.all([ctx.stopThenRead(socket, 'shelf-run'), supervising]);

  expect(ctx.removeDirectory).toHaveBeenCalledExactlyOnceWith(dirname(socket));
});

test('#runSupervisor listens on its socket through the launch host', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  void ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  expect(ctx.listenSocket).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ path: ready.supervisor?.socket }),
  );
});

test('#runSupervisor lets only its owner reach the socket, whatever the umask', async () => {
  const ctx = await setupTest();

  const umask = process.umask(0);

  onTestFinished(() => {
    process.umask(umask);
  });

  await ctx.seedRun('shelf-run');

  void ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    return view?.status === 'running' ? view : null;
  });

  const socket = ready.supervisor?.socket ?? '';

  const [folderInfo, socketInfo] = await Promise.all([stat(dirname(socket)), stat(socket)]);

  expect({
    folder: folderInfo.mode & 0o777,
    socket: socketInfo.mode & 0o777,
  }).toStrictEqual({ folder: 0o700, socket: 0o600 });
});

test('#runSupervisor ends the run and frees its socket when a startup step ignores the stop', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('queue-run');

  const teardown = new AbortController();

  const supervising = ctx.runSupervisor('queue-run', teardown.signal, 'late');

  const supervisor = await waitFor(async () => {
    const view = await ctx.readRun('queue-run');

    return view?.supervisor ?? null;
  });

  teardown.abort();

  await supervising;

  const view = await ctx.readRun('queue-run');

  expect(view?.status).toBe('crashed');
  expect(readdir(dirname(supervisor.socket))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('#runSupervisor stops a service that came up after the stop stopped waiting for it', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('queue-run');

  const teardown = new AbortController();

  const supervising = ctx.runSupervisor('queue-run', teardown.signal, 'late');

  await waitFor(async () => {
    const view = await ctx.readRun('queue-run');

    return view?.supervisor ?? null;
  });

  teardown.abort();

  await supervising;

  ctx.openStartGate();

  const stopCalls = await waitFor(() => (ctx.stopCalls.length > 0 ? ctx.stopCalls : null));

  expect(stopCalls).toStrictEqual(['queue']);
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
