import { expect, mock, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { startLaunch } from './start-launch.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'start-launch');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, logPath: join(directory, 'app.log') };
}

test('it resolves the endpoints from the first ready line', async () => {
  const ctx = await setupTest();

  const launch = await startLaunch({
    plan: {
      command: ['sh', '-c', 'echo booting; echo \'{"port":4100}\'; exec sleep 60'],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onExit: mock<(exitCode: number) => void>(),
  });

  onTestFinished(() => launch.stop());

  expect(launch.endpoints).toStrictEqual({ web: 'http://127.0.0.1:4100' });
});

test('it stops a server that the app started when the run stops', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'server.pid');

  const launch = await startLaunch({
    plan: {
      command: ['sh', '-c', 'sleep 60 & echo $! > "$0"; echo \'{"port":4100}\'; wait', pidPath],
      ready: (line) => (line['port'] === 4100 ? { web: 'http://127.0.0.1:4100' } : null),
    },
    logPath: ctx.logPath,
    readyTimeoutMs: 10_000,
    signal: new AbortController().signal,
    onExit: mock<(exitCode: number) => void>(),
  });

  await launch.stop();

  const pidText = await readFile(pidPath, 'utf8');

  const pid = Number(pidText);

  // The killed server lingers until init reaps it, so the test waits for it to go.
  const stopped = await waitFor(() => {
    try {
      process.kill(pid, 0);

      return null;
    } catch {
      return true;
    }
  });

  expect(stopped).toBeTrue();
});

test('it stops the app when the run stops before the app is ready', async () => {
  const ctx = await setupTest();

  const pidPath = join(ctx.directory, 'app.pid');

  const controller = new AbortController();

  const launching = startLaunch({
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
    onExit: mock<(exitCode: number) => void>(),
  });

  const [settled] = await Promise.allSettled([launching]);
  const pidText = await readFile(pidPath, 'utf8');

  const pid = Number(pidText);

  expect(settled.status).toBe('rejected');
  expect(() => process.kill(pid, 0)).toThrow();
});
