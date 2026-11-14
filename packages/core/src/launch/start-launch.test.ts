import { expect, mock, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { killProcessGroup } from '../host/kill-process-group.ts';
import { probeProcess } from '../host/probe-process.ts';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { WringerError } from '../wringer-error.ts';
import { readLaunchHost } from './read-launch-host.ts';
import type { LaunchHost } from './read-launch-host.ts';
import { startLaunch } from './start-launch.ts';
import type { LaunchRequest } from './start-launch.ts';

// The stack stops each app before it removes the folder the app logs into. A second stop repeats
// the first one's failure, which a test that stops the app has asserted already.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'start-launch');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const startAppOn = async (launchHost: LaunchHost, request: Omit<LaunchRequest, 'host'>) => {
    const launch = await startLaunch({ host: launchHost, ...request });

    stack.defer(async () => {
      await Promise.allSettled([launch.stop()]);
    });

    return launch;
  };

  return {
    directory,
    logPath: join(directory, 'app.log'),
    startApp: (request: Omit<LaunchRequest, 'host'>) => startAppOn(readLaunchHost(), request),
    startAppOn,
    readPID: async (path: string) => {
      const text = await readFile(path, 'utf8');

      return Number(text);
    },
    waitForExit: (pid: number) =>
      waitFor(() => {
        invariant(!probeProcess(pid), 'The process is still running.');

        return true;
      }),

    // A process the app started in a session of its own outlives the app's group, so the test
    // stops it before the folder goes.
    stopOutputHolder: (pidPath: string) => {
      stack.defer(async () => {
        const pidText = await readFile(pidPath, 'utf8');

        killProcessGroup(Number(pidText));
      });
    },
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
  });

  await launch.stop();

  const log = await readFile(ctx.logPath, 'utf8');

  expect(log.trimEnd().split('\n').at(-1)).toBe('20000');
});

test('it fails a stop with an environment error when a process outside the app holds its output open', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'holder.pid');

  const launch = await ctx.startApp({
    plan: {
      command: [
        'sh',
        '-c',
        `setsid sh -c 'echo $$ > "$1"; exec sleep 30' holder "$0" >&2 & while [ ! -s "$0" ]; do sleep 0.01; done; echo '{"port":4100}'; exec sleep 60`,
        pidPath,
      ],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
    stopGraceMs: 5000,
  });

  ctx.stopOutputHolder(pidPath);

  const [stopped] = await Promise.allSettled([launch.stop()]);

  expect(stopped).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message: expect.stringContaining("The app's output still had not reached its log"),
    }),
  });
});

test('it lets the process that launched the app exit after a stop gave up on a process holding its output', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'holder.pid');

  const script = [
    "import { readLaunchHost } from './read-launch-host.ts';",
    "import { startLaunch } from './start-launch.ts';",
    'const launch = await startLaunch({',
    '  host: readLaunchHost(),',
    '  plan: {',
    `    command: ['sh', '-c', ${JSON.stringify(
      `setsid sh -c 'echo $$ > "$1"; exec sleep 30' holder "$0" >&2 & while [ ! -s "$0" ]; do sleep 0.01; done; echo '{"port":4100}'; exec sleep 60`,
    )}, ${JSON.stringify(pidPath)}],`,
    "    ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),",
    '  },',
    `  logPath: ${JSON.stringify(ctx.logPath)},`,
    '  readyTimeoutMs: 10_000,',
    '  signal: new AbortController().signal,',
    '  onCrash: () => {},',
    '  onStopFailed: () => {},',
    '  stopGraceMs: 5000,',
    '});',
    'await launch.stop().catch((error) => console.log(error.message));',
  ].join('\n');

  const launcher = Bun.spawn([process.execPath, '--eval', script], {
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'inherit',

    // The holder sleeps 30 s, so a launcher that exits before this limit let go of its pipes.
    timeout: 4000,
  });

  onTestFinished(() => {
    launcher.kill();
  });

  ctx.stopOutputHolder(pidPath);

  const [output] = await Promise.all([new Response(launcher.stdout).text(), launcher.exited]);

  expect(launcher.signalCode).toBeNull();
  expect(output).toContain("The app's output still had not reached its log");
});

test('it keeps the startup failure and adds the failed stop when an app that never got ready cannot be stopped cleanly', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'holder.pid');

  const [launched] = await Promise.allSettled([
    ctx.startApp({
      plan: {
        command: [
          'sh',
          '-c',
          `setsid sh -c 'echo $$ > "$1"; exec sleep 30' holder "$0" >&2 & while [ ! -s "$0" ]; do sleep 0.01; done; exec sleep 60`,
          pidPath,
        ],
        ready: () => null,
      },
      logPath: ctx.logPath,
      readyTimeoutMs: 200,
      signal: new AbortController().signal,
      onCrash: mock<(reason: string) => void>(),
      onStopFailed: mock<(reason: string) => void>(),
      stopGraceMs: 5000,
    }),
  ]);

  ctx.stopOutputHolder(pidPath);

  expect(launched).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'timeout',
      message: expect.stringContaining("The app's output still had not reached its log"),
    }),
  });
});

test('it reports the failed stop of an app that never got ready to its caller', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'holder.pid');
  const onStopFailed = mock<(reason: string) => void>();

  await Promise.allSettled([
    ctx.startApp({
      plan: {
        command: [
          'sh',
          '-c',
          `setsid sh -c 'echo $$ > "$1"; exec sleep 30' holder "$0" >&2 & while [ ! -s "$0" ]; do sleep 0.01; done; exec sleep 60`,
          pidPath,
        ],
        ready: () => null,
      },
      logPath: ctx.logPath,
      readyTimeoutMs: 200,
      signal: new AbortController().signal,
      onCrash: mock<(reason: string) => void>(),
      onStopFailed,
      stopGraceMs: 5000,
    }),
  ]);

  ctx.stopOutputHolder(pidPath);

  expect(onStopFailed.mock.calls).toStrictEqual([
    [expect.stringContaining("The app's output still had not reached its log")],
  ]);
});

test('it reports the log failure of an app that never got ready to its caller as it stops', async () => {
  const ctx = await setupTest();

  const controller = new AbortController();

  const onStopFailed = mock<(reason: string) => void>();
  const notLogged = expect.stringMatching(/^The app's output could not be logged: .*EISDIR/u);

  const launching = ctx.startApp({
    plan: {
      command: [
        'sh',
        '-c',
        `trap 'echo closing; exit 0' TERM; echo booting; while :; do sleep 0.05; done`,
      ],
      ready: () => null,
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: controller.signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed,
    stopGraceMs: 5000,
  });

  await waitFor(async () => {
    const log = await readFile(ctx.logPath, 'utf8');

    invariant(log === 'booting\n', 'The app has not logged its first line yet.');
  });

  await rm(ctx.logPath);
  await mkdir(ctx.logPath);

  controller.abort();

  await Promise.allSettled([launching]);

  expect(onStopFailed.mock.calls).toStrictEqual([[notLogged]]);
});

test('it settles a stop whose log drain ran past its bound only once the last append is written', async () => {
  const ctx = await setupTest();

  const host = readLaunchHost();
  const order: string[] = [];

  const launch = await ctx.startAppOn(
    {
      ...host,
      appendLog: async (path, text) => {
        // Holds the app's last line past the stop's 2 s wait for its log.
        if (text.includes('closing')) {
          await once(AbortSignal.timeout(2500), 'abort');
        }

        await host.appendLog(path, text);

        order.push(text.trim());
      },
    },
    {
      plan: {
        command: [
          'sh',
          '-c',
          `trap 'echo closing; exit 0' TERM; echo '{"port":4100}'; while :; do sleep 0.05; done`,
        ],
        ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
      },
      logPath: ctx.logPath,
      readyTimeoutMs: 10_000,
      signal: new AbortController().signal,
      onCrash: mock<(reason: string) => void>(),
      onStopFailed: mock<(reason: string) => void>(),
      stopGraceMs: 5000,
    },
  );

  await Promise.allSettled([launch.stop()]);

  order.push('stopped');

  // The shell may also log `Terminated` for its killed `sleep`, so only the two lines in question
  // are compared.
  expect(order.filter((entry) => entry === 'closing' || entry === 'stopped')).toStrictEqual([
    'closing',
    'stopped',
  ]);
});

test('it fails a stop with the log failure that came while the app stopped', async () => {
  const ctx = await setupTest();

  const launch = await ctx.startApp({
    plan: {
      command: [
        'sh',
        '-c',
        `trap 'echo closing; exit 0' TERM; echo '{"port":4100}'; while :; do sleep 0.05; done`,
      ],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
    stopGraceMs: 5000,
  });

  await rm(ctx.logPath);
  await mkdir(ctx.logPath);

  const [stopped] = await Promise.allSettled([launch.stop()]);

  expect(stopped).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message: expect.stringMatching(/^The app's output could not be logged: .*EISDIR/u),
    }),
  });
});

test('it signals the app once a stop command that never ends has had its grace', async () => {
  const ctx = await setupTest();

  const host: LaunchHost = {
    ...readLaunchHost(),
    runProcess: () => Promise.withResolvers<never>().promise,
  };

  const pidPath = join(ctx.directory, 'app.pid');

  const launch = await ctx.startAppOn(host, {
    plan: {
      command: ['sh', '-c', `echo $$ > "$0"; echo '{"port":4100}'; exec sleep 60`, pidPath],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
      stop: ['shop-stop'],
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
    stopGraceMs: 200,
  });

  await launch.stop();

  const pid = await ctx.readPID(pidPath);

  expect(probeProcess(pid)).toBeFalse();
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
  });

  await Bun.write(exitPath, '');

  await waitFor(() => {
    invariant(onCrash.mock.calls.length > 0, 'The app has not crashed yet.');
  });

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
    stopGraceMs: 5000,
  });

  expect(launch.endpoints).toStrictEqual({ cwd: ctx.directory, shelf: 'herbs', row: '3' });
});

test('it runs the plan’s stop command with the host environment and the plan’s own', async () => {
  const ctx = await setupTest();

  const host = {
    ...readLaunchHost(),
    guard: [],
    cwd: ctx.directory,
    env: { PATH: process.env['PATH'], SHELF: 'herbs' },
  };

  const stoppedPath = join(ctx.directory, 'stop-env');

  const launch = await ctx.startAppOn(host, {
    plan: {
      command: ['sh', '-c', `echo '{"port":4100}'; exec sleep 60`],
      env: { ROW: '3' },
      stop: ['sh', '-c', 'echo "$SHELF $ROW" > "$0"', stoppedPath],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onCrash: mock<(reason: string) => void>(),
    onStopFailed: mock<(reason: string) => void>(),
    stopGraceMs: 5000,
  });

  await launch.stop();

  const stopEnv = await readFile(stoppedPath, 'utf8');

  expect(stopEnv).toBe('herbs 3\n');
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

  const launch = await ctx.startAppOn(host, {
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
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
    stopGraceMs: 5000,
  });

  expect(launching).rejects.toMatchObject({ code: 'environment' });
});

test('it reports no failed stop when the log failure that failed the start is the only one', async () => {
  const ctx = await setupTest();

  const onStopFailed = mock<(reason: string) => void>();

  await mkdir(ctx.logPath);

  await Promise.allSettled([
    ctx.startApp({
      plan: {
        command: ['sh', '-c', 'echo booting; exec sleep 60'],
        ready: () => null,
      },
      logPath: ctx.logPath,
      readyTimeoutMs: 10_000,
      signal: new AbortController().signal,
      onCrash: mock<(reason: string) => void>(),
      onStopFailed,
      stopGraceMs: 5000,
    }),
  ]);

  expect(onStopFailed.mock.calls).toStrictEqual([]);
});
