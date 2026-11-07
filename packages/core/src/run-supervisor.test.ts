import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { once } from 'node:events';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { buildStandInServices } from '../test-utils/build-stand-in-services.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { callSupervisor } from './call-supervisor.ts';
import { createRepoState } from './create-repo-state.ts';
import { createWringer } from './create-wringer.ts';
import { defineDriver } from './define-driver.ts';
import { local } from './local.ts';
import { readLaunchHost } from './read-launch-host.ts';
import { runSupervisor } from './run-supervisor.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import { WringerError } from './wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-supervisor');

  const stopGate = Promise.withResolvers<undefined>();
  const startGate = Promise.withResolvers<undefined>();
  const holdGate = Promise.withResolvers<undefined>();
  const reports: string[] = [];
  const supervisors: Promise<void>[] = [];

  const teardown = new AbortController();

  // One cleanup stops every supervisor the test started, then removes the folder they write into.
  onTestFinished(async () => {
    stopGate.resolve(undefined);
    startGate.resolve(undefined);
    holdGate.resolve(undefined);
    teardown.abort();

    await Promise.allSettled(supervisors);

    await rm(directory, { recursive: true, force: true });
  });

  const services = buildStandInServices({
    stop: stopGate.promise,
    start: startGate.promise,
    hold: holdGate.promise,
    readLog: (path) => readFile(path, 'utf8'),
  });

  const leaky = defineDriver({
    name: 'leaky',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { store: services.store },
    client: () => ({}),
  });

  const tardy = defineDriver({
    name: 'tardy',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { queue: services.queue },
    client: () => ({}),
  });

  const tidy = defineDriver({
    name: 'tidy',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { shelf: services.shelf },
    client: () => ({}),
  });

  const lagging = defineDriver({
    name: 'lagging',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { queue: services.queue },
    client: () => ({}),
  });

  const brittle = defineDriver({
    name: 'brittle',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { till: services.till },
    client: () => ({}),
  });

  const scribe = defineDriver({
    name: 'scribe',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { ledger: services.ledger },
    client: () => ({}),
  });

  const stuck = defineDriver({
    name: 'stuck',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { counter: services.counter },
    client: () => ({}),
  });

  const busy = defineDriver({
    name: 'busy',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { press: services.press },
    client: () => ({}),
  });

  const cacheMain = defineDriver({
    name: 'cache/main',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { store: services.shelf },
    client: () => ({}),
  });

  const cache = defineDriver({
    name: 'cache',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: { 'main/store': services.shelf },
    client: () => ({}),
  });

  const wringer = createWringer({ name: 'shop' })
    .use(cacheMain({}))
    .use(cache({}))
    .use(leaky({}))
    .use(stuck({}))
    .use(tardy({}))
    .use(tidy({}))
    .use(lagging({}))
    .use(brittle({}))
    .use(scribe({}))
    .use(busy({}))
    .target('busy-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { busy: () => ({}) },
    })
    .target('box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { leaky: () => ({}) },
    })
    .target('stuck-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { stuck: () => ({}) },
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
    .target('mixed-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { tidy: () => ({}), lagging: () => ({}) },
    })
    .target('clash-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { 'cache/main': () => ({}), cache: () => ({}) },
    })
    .target('held-box', {
      mode: 'launch',
      access: 'read-write',
      host: local(),

      // The holder marks itself once it has its own session, so a stop never catches it in the
      // app's group.
      launch: (launch) => ({
        command: [
          'sh',
          '-c',
          `setsid sh -c ': > "$1"; exec sleep 3' holder "$0" & while [ ! -e "$0" ]; do sleep 0.01; done; while :; do sleep 0.05; done`,
          join(launch.runDirectory, 'holder-ready'),
        ],
        ready: () => null,
      }),
      drivers: {},
    })
    .build();

  const state = createRepoState(directory, wringer.stateDir);
  const appendEvent = spyOn(state, 'appendEvent');
  const launchHost = readLaunchHost();
  const removeDirectory = spyOn(launchHost, 'removeDirectory');
  const listenSocket = spyOn(launchHost, 'listenSupervisorSocket');

  return {
    stopCalls: services.calls,
    reports,

    // Reads the run as it stands the moment the stop call answers, with success or an error.
    stopThenRead: async (socket: string, runID: string) => {
      await Promise.allSettled([
        callSupervisor({
          socket,
          request: { service: supervisorServiceName, method: 'stop', args: null },
          signal: AbortSignal.timeout(5000),
        }),
      ]);

      return state.readRun(runID);
    },
    callStop: (socket: string) =>
      callSupervisor({
        socket,
        request: { service: supervisorServiceName, method: 'stop', args: null },
        signal: AbortSignal.timeout(5000),
      }),
    callHold: (socket: string) =>
      callSupervisor({
        socket,
        request: { service: 'stuck/counter', method: 'hold', args: null },
        signal: AbortSignal.timeout(5000),
      }),
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
    readRunEvents: (runID: string) => state.readRunEvents(runID),
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
    runSupervisor: (
      runID: string,
      signal: AbortSignal = teardown.signal,
      target = 'box',
      stopWaitMs = 1000,
    ) => {
      const supervising = runSupervisor({
        wringer,
        launchHost,
        state,
        runID,
        target,
        readyTimeoutMs: 5000,
        stopWaitMs,
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

test('#runSupervisor answers a second stop only once the first has ended the run', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  const socket = ready.supervisor?.socket ?? '';
  const first = ctx.stopThenRead(socket, 'shelf-run');

  await waitFor(() => {
    invariant(ctx.stopCalls.length > 0, 'No stop has run yet.');
  });

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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  await rm(join(ctx.runFolder('shelf-run'), 'manifest.json'));
  await mkdir(join(ctx.runFolder('shelf-run'), 'manifest.json', 'blocked'), { recursive: true });

  ctx.openStopGate();

  const socket = ready.supervisor?.socket ?? '';

  const [stopFailure] = await Promise.all([
    ctx.callStop(socket).catch((error: unknown) => error),
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  await Promise.allSettled([ctx.callStop(ready.supervisor?.socket ?? ''), supervising]);

  const ended = await ctx.readRun('shelf-run');

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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  await Promise.all([ctx.stopThenRead(ready.supervisor?.socket ?? '', 'shelf-run'), supervising]);

  expect(ctx.stopCalls).toContain('closing');
});

test('#runSupervisor lets a service run a command from its stop', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', undefined, 'tidy-box');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  ctx.openStopGate();

  const socket = ready.supervisor?.socket ?? '';

  await Promise.all([ctx.stopThenRead(socket, 'shelf-run'), supervising]);

  expect(ctx.removeDirectory).toHaveBeenCalledExactlyOnceWith(dirname(socket));
});

test('#runSupervisor ends a connection that sent no request when the run stops', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  const socket = ready.supervisor?.socket ?? '';
  const idle = createConnection(socket);

  onTestFinished(() => {
    idle.destroy();
  });

  await once(idle, 'connect');

  ctx.openStopGate();

  await Promise.all([ctx.stopThenRead(socket, 'shelf-run'), supervising]);

  await waitFor(() => {
    invariant(idle.closed, 'The idle connection is still open.');
  });

  expect(idle.closed).toBeTrue();
});

test('#runSupervisor ends a connection whose client keeps its side open after the answer when the run stops', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  const socket = ready.supervisor?.socket ?? '';
  const lingering = createConnection({ path: socket, allowHalfOpen: true });
  const writeErrors: unknown[] = [];

  onTestFinished(() => {
    lingering.destroy();
  });

  lingering.on('error', (error) => {
    writeErrors.push(error);
  });

  await once(lingering, 'connect');

  lingering.write(
    `${JSON.stringify({ service: supervisorServiceName, method: 'status', args: null })}\n`,
  );

  lingering.resume();

  await once(lingering, 'end');

  ctx.openStopGate();

  await Promise.all([ctx.stopThenRead(socket, 'shelf-run'), supervising]);

  // The client learns that the supervisor closed its end only when it writes to it.
  const closed = await waitFor(() => {
    lingering.write('ping\n');

    invariant(lingering.closed, 'The lingering connection is still open.');

    return lingering.closed;
  });

  expect(closed).toBeTrue();
});

test('#runSupervisor ends the run and frees its socket when a service call never settles', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run', undefined, 'stuck-box');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  const socket = ready.supervisor?.socket ?? '';
  const holding = Promise.allSettled([ctx.callHold(socket)]);

  await waitFor(() => {
    invariant(ctx.stopCalls.includes('hold'), 'The held stop has not run yet.');
  });

  await Promise.all([ctx.callStop(socket), supervising]);

  const [held] = await holding;

  expect({ removed: ctx.removeDirectory.mock.calls, held: held.status }).toStrictEqual({
    removed: [[dirname(socket)]],
    held: 'rejected',
  });
});

test('#runSupervisor listens on its socket through the launch host', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  void ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
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

    invariant(view?.supervisor, 'The run has no supervisor yet.');

    return view.supervisor;
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

    invariant(view?.supervisor, 'The run has no supervisor yet.');

    return view.supervisor;
  });

  teardown.abort();

  await supervising;

  ctx.openStartGate();

  const stopCalls = await waitFor(() => {
    invariant(ctx.stopCalls.length > 0, 'No stop has run yet.');

    return ctx.stopCalls;
  });

  expect(stopCalls).toStrictEqual(['queue']);
});

test('#runSupervisor ends a command the startup runs once the stop stops waiting for the startup', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('press-run');

  const teardown = new AbortController();

  const supervising = ctx.runSupervisor('press-run', teardown.signal, 'busy-box');

  await waitFor(async () => {
    const view = await ctx.readRun('press-run');

    invariant(view?.supervisor, 'The run has no supervisor yet.');

    return view.supervisor;
  });

  teardown.abort();

  await supervising;

  const calls = await waitFor(
    () => {
      invariant(ctx.stopCalls.length > 0, 'No stop has run yet.');

      return ctx.stopCalls;
    },
    { timeoutMs: 3000 },
  );

  expect(calls).toStrictEqual(['press command rejected']);
});

test('#runSupervisor logs and answers the failed stop of an app that the stop cancelled before it got ready', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('held-run');

  const supervising = ctx.runSupervisor('held-run', undefined, 'held-box', 4000);

  const supervisor = await waitFor(async () => {
    const view = await ctx.readRun('held-run');

    invariant(view?.supervisor, 'The run has no supervisor yet.');

    return view.supervisor;
  });

  await waitFor(async () => {
    const holding = await Bun.file(join(ctx.runFolder('held-run'), 'holder-ready')).exists();

    invariant(holding, 'The app has not started its output holder yet.');
  });

  const [answer] = await Promise.allSettled([ctx.callStop(supervisor.socket), supervising]);
  const ended = await ctx.readRun('held-run');

  expect({ answer, reason: ended?.crashReason }).toStrictEqual({
    answer: {
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'environment',
        message: expect.stringContaining("app: The app's output still had not reached its log"),
      }),
    },
    reason: expect.stringContaining("cleanup failed for app: The app's output still had not"),
  });
});

test('#runSupervisor lets a service that came up run a command from its stop after the stop gave up on a later startup', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('mixed-run');

  const teardown = new AbortController();

  const supervising = ctx.runSupervisor('mixed-run', teardown.signal, 'mixed-box');

  await waitFor(async () => {
    const events = await ctx.readRunEvents('mixed-run');

    invariant(
      events.some((event) => event.type === 'service-ready'),
      'No service is ready yet.',
    );
  });

  teardown.abort();

  await supervising;

  expect(ctx.stopCalls).toStrictEqual(['shelf exited 0']);
});

test('#runSupervisor starts no service and ends the run when two driver services share a key', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('clash-run');
  await ctx.runSupervisor('clash-run', undefined, 'clash-box');

  const ended = await ctx.readRun('clash-run');

  expect({ reason: ended?.crashReason, stopCalls: ctx.stopCalls }).toStrictEqual({
    reason: 'Two driver services share the key cache/main/store.',
    stopCalls: [],
  });
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

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  ctx.openStopGate();

  await Promise.allSettled([ctx.callStop(ready.supervisor?.socket ?? ''), supervising]);

  const ended = await ctx.readRun('shelf-run');

  expect(ended?.crashReason).toBe('cleanup failed for leaky/store: The store kept its lock.');
});

test('#runSupervisor answers a stop with an environment error when a service fails to stop', async () => {
  const ctx = await setupTest();

  await ctx.seedRun('shelf-run');

  const supervising = ctx.runSupervisor('shelf-run');

  const ready = await waitFor(async () => {
    const view = await ctx.readRun('shelf-run');

    invariant(view?.status === 'running', 'The run is not running yet.');

    return view;
  });

  ctx.openStopGate();

  const [answer] = await Promise.allSettled([
    ctx.callStop(ready.supervisor?.socket ?? ''),
    supervising,
  ]);

  expect(answer).toMatchObject({ status: 'rejected', reason: { code: 'environment' } });
});
