import { expect, test } from 'bun:test';
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
