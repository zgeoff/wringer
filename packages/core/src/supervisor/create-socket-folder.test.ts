import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { updateEnv } from '@zgeoff/testing/helpers';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { callSupervisor } from './call-supervisor.ts';
import { createSocketFolder } from './create-socket-folder.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'create-socket-folder');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it makes the folder of a short socket path owner-only, even when it exists already', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.directory, 'run'), { mode: 0o755 });

  const preferred = relative(process.cwd(), join(ctx.directory, 'run', 'sock'));

  const socket = await createSocketFolder(preferred);
  const info = await stat(dirname(socket));

  expect({ socket, mode: info.mode & 0o777 }).toStrictEqual({ socket: preferred, mode: 0o700 });
});

test('it moves a socket path too long for a socket to an owner-only folder in the temp folder', async () => {
  const ctx = await setupTest();
  const socket = await createSocketFolder(join(ctx.directory, 'run'.repeat(40), 'sock'));

  onTestFinished(() => rm(dirname(socket), { recursive: true, force: true }));

  const info = await stat(dirname(socket));

  expect({ parent: dirname(dirname(socket)), mode: info.mode & 0o777 }).toStrictEqual({
    parent: tmpdir(),
    mode: 0o700,
  });
});

test('it moves to a socket the supervisor listens on and answers when the temp folder is long', async () => {
  const ctx = await setupTest();

  const longTemp = join(ctx.directory, 'long-temp'.repeat(25));

  await mkdir(longTemp, { recursive: true });

  updateEnv('TMPDIR', longTemp);

  const socket = await createSocketFolder(join(ctx.directory, 'run'.repeat(40), 'sock'));

  expect(Buffer.byteLength(socket)).toBeGreaterThan(104);

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
