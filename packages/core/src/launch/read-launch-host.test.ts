import { expect, onTestFinished, test } from 'bun:test';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createGuardedApp } from '../test-utils/create-guarded-app.ts';
import { readLaunchHost } from './read-launch-host.ts';

test('it reads the launch guard, the folder and the environment of this process', () => {
  const host = readLaunchHost();

  expect(host).toStrictEqual({
    guard: expect.any(Array),
    cwd: process.cwd(),
    env: { ...process.env },
    spawnApp: expect.any(Function),
    appendLog: expect.any(Function),
    createDirectory: expect.any(Function),
    createSocketFolder: expect.any(Function),
    removeDirectory: expect.any(Function),
    listenSupervisorSocket: expect.any(Function),
    killProcessGroup: expect.any(Function),
    runProcess: expect.any(Function),
  });
});

test.skipIf(Bun.which('setpriv') === null)(
  'it guards the app so that it exits when the process that launched it is killed',
  async () => {
    const app = await createGuardedApp();

    onTestFinished(app.stop);

    await app.killParent();

    const exited = await waitFor(async () => {
      const running = await app.probeRunning();

      invariant(!running, 'The app is still running.');

      return true;
    });

    expect(exited).toBeTrue();
  },
);
