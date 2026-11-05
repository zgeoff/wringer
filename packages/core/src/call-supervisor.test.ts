import { expect, mock, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import type { SupervisorRequestHandler } from './answer-supervisor-connection.ts';
import { callSupervisor } from './call-supervisor.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'call-supervisor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const socket = join(directory, 'supervisor.sock');
  const handle = mock<SupervisorRequestHandler>(() => Promise.resolve({ notes: 2 }));

  const server = await listenSupervisorSocket({
    path: socket,
    answerRequest: handle,
    onTransportError: (error) => {
      throw error;
    },
  });

  onTestFinished(() => server.close(1000));

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

test('it answers a result JSON cannot hold with an internal error', async () => {
  const ctx = await setupTest();

  ctx.handle.mockImplementationOnce(() => Promise.resolve({ notes: 2n }));

  const calling = callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {} },
    signal: AbortSignal.timeout(5000),
  });

  expect(calling).rejects.toMatchObject({ code: 'internal' });
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
