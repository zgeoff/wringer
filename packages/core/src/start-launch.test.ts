import { expect, mock, onTestFinished, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { probeProcess } from './probe-process.ts';
import { readLaunchHost } from './read-launch-host.ts';
import type { LaunchHost } from './read-launch-host.ts';
import { startLaunch } from './start-launch.ts';
import type { LaunchRequest } from './start-launch.ts';
import { WringerError } from './wringer-error.ts';

// The stack stops each app before it removes the folder the app logs into.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'start-launch');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const host = readLaunchHost();

  return {
    directory,
    logPath: join(directory, 'app.log'),
    startApp: async (request: Omit<LaunchRequest, 'host'>) => {
      const launch = await startLaunch({ host, ...request });

      stack.defer(() => launch.stop());

      return launch;
    },
    startAppOn: async (launchHost: LaunchHost, request: Omit<LaunchRequest, 'host'>) => {
      const launch = await startLaunch({ host: launchHost, ...request });

      stack.defer(() => launch.stop());

      return launch;
    },
    readPID: async (path: string) => {
      const text = await readFile(path, 'utf8');

      return Number(text);
    },
    waitForExit: (pid: number) => waitFor(() => (probeProcess(pid) ? null : true)),
  };
}

test('it resolves the endpoints from the first ready line', async () => {
  const ctx = await setupTest();

  const launch = await ctx.startApp({
    plan: {
      command: ['sh', '-c', 'echo booting; echo \'{"port":4100}\'; exec sleep 60'],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launch.endpoints).toStrictEqual({ web: 'http://127.0.0.1:4100' });
});

test('it stops a server that the app started when the run stops', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'server.pid');

  const launch = await ctx.startApp({
    plan: {
      command: ['sh', '-c', 'sleep 60 & echo $! > "$0"; echo \'{"port":4100}\'; wait', pidPath],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  await launch.stop();

  const pid = await ctx.readPID(pidPath);

  // The killed server lingers until init reaps it, so the test waits for it to go.
  const exited = await ctx.waitForExit(pid);

  expect(exited).toBeTrue();
});

test('it ends a stop only once the lines the app printed as it stopped are in its log', async () => {
  const ctx = await setupTest();

  const launch = await ctx.startApp({
    plan: {
      command: [
        'sh',
        '-c',
        `trap 'seq 1 20000; exit 0' TERM; echo '{"port":4100}'; while :; do sleep 0.05; done`,
      ],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  await launch.stop();

  const log = await readFile(ctx.logPath, 'utf8');

  expect(log.trimEnd().split('\n').at(-1)).toBe('20000');
});

test('it fails a stop with an environment error when a process outside the app holds its output open', async () => {
  const ctx = await setupTest();

  const real = readLaunchHost();

  // The app's stderr stays open after the app exits, as when another process holds it.
  const host: LaunchHost = {
    ...real,
    spawnApp: (argv, options) => {
      const app = real.spawnApp(argv, options);

      return {
        pid: app.pid,
        stdout: app.stdout,
        stderr: new ReadableStream<Uint8Array>(),
        exited: app.exited,
      };
    },
  };

  const launch = await startLaunch({
    host,
    plan: {
      command: ['sh', '-c', 'echo \'{"port":4100}\'; exec sleep 60'],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launch.stop()).rejects.toMatchObject({ code: 'environment' });
});

test('it keeps the startup failure and adds the failed stop when an app that never got ready cannot be stopped cleanly', async () => {
  const ctx = await setupTest();

  const real = readLaunchHost();

  // The app's stderr stays open after the app exits, as when another process holds it.
  const host: LaunchHost = {
    ...real,
    spawnApp: (argv, options) => {
      const app = real.spawnApp(argv, options);

      return {
        pid: app.pid,
        stdout: app.stdout,
        stderr: new ReadableStream<Uint8Array>(),
        exited: app.exited,
      };
    },
  };

  const launching = startLaunch({
    host,
    plan: { command: ['sh', '-c', 'exec sleep 60'], ready: () => null },
    logPath: ctx.logPath,
    readyTimeoutMs: 200,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launching).rejects.toMatchObject({
    code: 'timeout',
    message: expect.stringContaining("The app's output still had not reached its log"),
  });
});

test('it reports the failed stop of an app that never got ready to its caller', async () => {
  const ctx = await setupTest();

  const real = readLaunchHost();
  const onStopFailed = mock<(reason: string) => void>();

  const host: LaunchHost = {
    ...real,
    spawnApp: (argv, options) => {
      const app = real.spawnApp(argv, options);

      return {
        pid: app.pid,
        stdout: app.stdout,
        stderr: new ReadableStream<Uint8Array>(),
        exited: app.exited,
      };
    },
  };

  await Promise.allSettled([
    startLaunch({
      host,
      plan: { command: ['sh', '-c', 'exec sleep 60'], ready: () => null },
      logPath: ctx.logPath,
      readyTimeoutMs: 200,
      signal: new AbortController().signal,
      onCrash: mock<(reason: string) => void>(),
      onStopFailed,
    }),
  ]);

  expect(onStopFailed.mock.calls).toStrictEqual([
    [expect.stringContaining("The app's output still had not reached its log")],
  ]);
});

test('it runs the plan’s stop command, then stops the app and its server when that command fails', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'server.pid');
  const stoppedPath = join(ctx.directory, 'stop-ran');

  const launch = await ctx.startApp({
    plan: {
      command: ['sh', '-c', 'sleep 60 & echo $! > "$0"; echo \'{"port":4100}\'; wait', pidPath],
      stop: ['sh', '-c', 'echo ran > "$0"; exit 4', stoppedPath],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  await launch.stop();

  const pid = await ctx.readPID(pidPath);
  const exited = await ctx.waitForExit(pid);
  const stopRan = await readFile(stoppedPath, 'utf8');

  expect({ stopRan, exited }).toStrictEqual({ stopRan: 'ran\n', exited: true });
});

test('it stops the app when the run stops before the app is ready', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'app.pid');

  const controller = new AbortController();

  const launching = ctx.startApp({
    plan: {
      command: ['sh', '-c', 'echo $$ > "$0"; echo booting; exec sleep 60', pidPath],

      // The app logs one line, `booting`, so the run stops as the app boots.
      ready: () => {
        controller.abort();

        return null;
      },
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: controller.signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  const [settled] = await Promise.allSettled([launching]);
  const pid = await ctx.readPID(pidPath);
  const exited = await ctx.waitForExit(pid);

  expect({ status: settled.status, exited }).toStrictEqual({ status: 'rejected', exited: true });
});

test('it reports a crash with the exit code when a ready app exits', async () => {
  const ctx = await setupTest();

  const onCrash = mock<(reason: string) => void>();
  const exitPath = join(ctx.directory, 'exit');

  await ctx.startApp({
    plan: {
      command: [
        'sh',
        '-c',
        'echo \'{"port":4100}\'; while [ ! -e "$0" ]; do sleep 0.05; done; exit 7',
        exitPath,
      ],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash,
    onStopFailed: mock<(reason: string) => void>(),
  });

  await Bun.write(exitPath, '');

  await waitFor(() => (onCrash.mock.calls.length > 0 ? true : null));

  expect(onCrash.mock.calls).toStrictEqual([['The app exited with code 7.']]);
});

test('it starts the app in the host folder with the host environment and the plan’s own', async () => {
  const ctx = await setupTest();

  const host = {
    ...readLaunchHost(),
    guard: [],
    cwd: ctx.directory,
    env: { PATH: process.env['PATH'], SHELF: 'herbs' },
  };

  const launch = await ctx.startAppOn(host, {
    plan: {
      command: [
        'sh',
        '-c',
        `printf '{"cwd":"%s","shelf":"%s","row":"%s"}' "$PWD" "$SHELF" "$ROW"; echo; exec sleep 60`,
      ],
      env: { ROW: '3' },
      ready: (line) => ({
        cwd: String(line['cwd']),
        shelf: String(line['shelf']),
        row: String(line['row']),
      }),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launch.endpoints).toStrictEqual({ cwd: ctx.directory, shelf: 'herbs', row: '3' });
});

test('it creates the log folder, runs the stop command and signals the app through its host', async () => {
  const ctx = await setupTest();

  const real = readLaunchHost();

  const host = {
    ...real,
    createDirectory: mock(real.createDirectory),
    runProcess: mock(real.runProcess),
    killProcessGroup: mock(real.killProcessGroup),
  };

  const launch = await startLaunch({
    host,
    plan: {
      command: ['sh', '-c', 'echo \'{"port":4100}\'; exec sleep 60'],
      stop: ['true'],
      ready: () => ({}),
    },
    logPath: join(ctx.directory, 'logs', 'app.log'),
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  await launch.stop();

  expect({
    folders: host.createDirectory.mock.calls,
    stopCommands: host.runProcess.mock.calls.map(([request]) => request.argv),
    signals: host.killProcessGroup.mock.calls.map(([, signal]) => signal),
  }).toStrictEqual({
    folders: [[join(ctx.directory, 'logs')]],
    stopCommands: [['true']],
    signals: expect.arrayContaining(['SIGTERM']),
  });
});

test('it refuses with an environment error when the app cannot start', async () => {
  const ctx = await setupTest();

  const launching = ctx.startApp({
    plan: {
      command: ['sh', '-c', 'exec sleep 60'],
      cwd: join(ctx.directory, 'missing'),
      ready: () => null,
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launching).rejects.toMatchObject({ code: 'environment' });
});

test('it refuses to start the app of a run that stopped already', async () => {
  const ctx = await setupTest();

  const launching = ctx.startApp({
    plan: { command: ['sleep', '60'], cwd: join(ctx.directory, 'missing'), ready: () => null },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: AbortSignal.abort(),
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launching).rejects.toThrowWithMessage(
    WringerError,
    'The run stopped before the app was ready.',
  );
});

test('it refuses a log folder it cannot create before it tries to start the app', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'logs'), 'a file where the log folder goes\n');

  const launching = ctx.startApp({
    plan: { command: ['sleep', '60'], cwd: join(ctx.directory, 'missing'), ready: () => null },
    logPath: join(ctx.directory, 'logs', 'app.log'),
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launching).rejects.toThrowWithMessage(
    WringerError,
    /^The folder for the app log could not be created/u,
  );
});

test('it refuses with an environment error when the app log cannot be written', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.logPath);

  const launching = ctx.startApp({
    plan: {
      command: ['sh', '-c', 'echo booting; exec sleep 60'],
      ready: () => null,
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
  });

  expect(launching).rejects.toMatchObject({ code: 'environment' });
});
