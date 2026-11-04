import { expect, mock, onTestFinished, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { probeProcess } from './probe-process.ts';
import { readLaunchHost } from './read-launch-host.ts';
import { startLaunch } from './start-launch.ts';
import type { LaunchRequest } from './start-launch.ts';
import { WringerError } from './wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'start-launch');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const host = readLaunchHost();

  return {
    directory,
    logPath: join(directory, 'app.log'),
    startApp: async (request: Omit<LaunchRequest, 'host'>) => {
      const launch = await startLaunch({ host, ...request });

      onTestFinished(() => launch.stop());

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
  });

  await launch.stop();

  const pid = await ctx.readPID(pidPath);

  // The killed server lingers until init reaps it, so the test waits for it to go.
  const exited = await ctx.waitForExit(pid);

  expect(exited).toBeTrue();
});

test('it stops the app when the run stops before the app is ready', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'app.pid');

  const controller = new AbortController();

  const launching = ctx.startApp({
    plan: {
      command: ['sh', '-c', 'echo $$ > "$0"; echo booting; exec sleep 60', pidPath],
      ready: (line) => {
        if (line['message'] === 'booting') {
          controller.abort();
        }

        return null;
      },
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: controller.signal,
    onCrash: mock<(reason: string) => void>(),
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
  });

  await Bun.write(exitPath, '');

  await waitFor(() => (onCrash.mock.calls.length > 0 ? true : null));

  expect(onCrash.mock.calls).toStrictEqual([['The app exited with code 7.']]);
});

test('it starts the app in the host folder with the host environment and the plan’s own', async () => {
  const ctx = await setupTest();

  const launch = await startLaunch({
    host: { guard: [], cwd: ctx.directory, env: { PATH: process.env['PATH'], SHELF: 'herbs' } },
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
  });

  onTestFinished(() => launch.stop());

  expect(launch.endpoints).toStrictEqual({ cwd: ctx.directory, shelf: 'herbs', row: '3' });
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
  });

  expect(launching).rejects.toMatchObject({ code: 'environment' });
});
