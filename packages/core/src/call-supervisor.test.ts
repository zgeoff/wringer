import { expect, mock, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { callSupervisor } from './call-supervisor.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';
import type { SupervisorRequestHandler } from './listen-supervisor-socket.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'call-supervisor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const socket = join(directory, 'supervisor.sock');
  const handle = mock<SupervisorRequestHandler>(() => Promise.resolve({ notes: 2 }));

  const server = await listenSupervisorSocket(socket, handle);

  onTestFinished(() => {
    server.close();
  });

  return { socket, handle };
}

test('it returns the result the supervisor answers', async () => {
  const ctx = await setupTest();

  const result = await callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {} },
    signal: new AbortController().signal,
  });

  expect(result).toStrictEqual({ notes: 2 });
});

test('it refuses a call whose signal aborted before the call, and sends no request', async () => {
  const ctx = await setupTest();

  const failure = await callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {} },
    signal: AbortSignal.abort(),
  }).catch((error: unknown) => error);

  expect({ failure, requests: ctx.handle.mock.calls.length }).toStrictEqual({
    failure: expect.objectContaining({ code: 'timeout' }),
    requests: 0,
  });
});
