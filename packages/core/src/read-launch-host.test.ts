import { expect, test } from 'bun:test';
import { readLaunchHost } from './read-launch-host.ts';

test('it reads the guard that setpriv gives, the folder and the environment of this process', () => {
  const host = readLaunchHost();
  const guard = Bun.which('setpriv') === null ? [] : ['setpriv', '--pdeathsig', 'KILL', '--'];

  expect(host).toStrictEqual({
    guard,
    cwd: process.cwd(),
    env: { ...process.env },
    spawnApp: expect.any(Function),
    appendLog: expect.any(Function),
    createDirectory: expect.any(Function),
    createSocketFolder: expect.any(Function),
    removeDirectory: expect.any(Function),
    killProcessGroup: expect.any(Function),
    runProcess: expect.any(Function),
  });
});
