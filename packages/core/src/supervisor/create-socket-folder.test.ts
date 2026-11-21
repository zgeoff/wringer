import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { updateEnv } from '@zgeoff/testing';
import { createTempDir } from '@zgeoff/testing/fs';
import { callSupervisor } from './call-supervisor.ts';
import { createSocketFolder } from './create-socket-folder.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';

function setupTest() {
  // A socket path has a length limit, so the folder sits in a short temp folder whatever TMPDIR holds.
  updateEnv('TMPDIR', '/tmp');

  const directory = createTempDir('create-socket-folder').path;

  return { directory };
}

test('it makes the folder of a short socket path owner-only, even when it exists already', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.directory, 'run'), { mode: 0o755 });

  const preferred = relative(process.cwd(), join(ctx.directory, 'run', 'sock'));

  const socket = await createSocketFolder(preferred);
  const info = await stat(dirname(socket));

  expect({ socket, mode: info.mode & 0o777 }).toStrictEqual({ socket: preferred, mode: 0o700 });
});

test('it moves a socket path too long for a socket to an owner-only folder in the temp folder', async () => {
  const ctx = setupTest();

  updateEnv('TMPDIR', '/var/tmp');

  const socket = await createSocketFolder(join(ctx.directory, 'run'.repeat(40), 'sock'));

  onTestFinished(() => rm(dirname(socket), { recursive: true, force: true }));

  const info = await stat(dirname(socket));

  expect({ parent: dirname(dirname(socket)), mode: info.mode & 0o777 }).toStrictEqual({
    parent: '/var/tmp',
    mode: 0o700,
  });
});

test('it moves to a socket under /tmp, in an owner-only folder, when the temp folder is long', async () => {
  const ctx = setupTest();
  const longTemp = join(ctx.directory, 'long-temp'.repeat(25));

  await mkdir(longTemp, { recursive: true });

  updateEnv('TMPDIR', longTemp);

  const socket = await createSocketFolder(join(ctx.directory, 'run'.repeat(40), 'sock'));

  onTestFinished(() => rm(dirname(socket), { recursive: true, force: true }));

  const info = await stat(dirname(socket));

  expect({ parent: dirname(dirname(socket)), mode: info.mode & 0o777 }).toStrictEqual({
    parent: '/tmp',
    mode: 0o700,
  });
});

test('it moves to a socket the supervisor listens on and answers when the temp folder is long', async () => {
  const ctx = setupTest();
  const longTemp = join(ctx.directory, 'long-temp'.repeat(25));

  await mkdir(longTemp, { recursive: true });

  updateEnv('TMPDIR', longTemp);

  const socket = await createSocketFolder(join(ctx.directory, 'run'.repeat(40), 'sock'));

  onTestFinished(() => rm(dirname(socket), { recursive: true, force: true }));

  const server = await listenSupervisorSocket({
    path: socket,
    answerRequest: (request) => Promise.resolve({ method: request.method }),
    onTransportError: () => {},
  });

  onTestFinished(() => server.close(1000));

  const answer = await callSupervisor({
    socket,
    request: { service: 'shelf', method: 'ping', args: null },
    signal: AbortSignal.timeout(5000),
  });

  expect(answer).toStrictEqual({ method: 'ping' });
});
