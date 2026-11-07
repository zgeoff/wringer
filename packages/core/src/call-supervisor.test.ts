import { expect, mock, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisorRequestHandler } from './answer-supervisor-connection.ts';
import { callSupervisor } from './call-supervisor.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

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

test("it returns the supervisor's answer to a call whose signal aborts while the supervisor works", async () => {
  const ctx = await setupTest();

  const caller = new AbortController();

  ctx.handle.mockImplementationOnce(async () => {
    caller.abort();

    await once(AbortSignal.timeout(100), 'abort');

    return { notes: 3 };
  });

  const result = await callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {} },
    signal: caller.signal,
  });

  expect(result).toStrictEqual({ notes: 3 });
});

test('it times out a call whose supervisor does not answer within the wait after the abort', async () => {
  const ctx = await setupTest();

  const caller = new AbortController();

  const held = Promise.withResolvers<unknown>();

  onTestFinished(() => {
    held.resolve(null);
  });

  ctx.handle.mockImplementationOnce(() => {
    caller.abort();

    return held.promise;
  });

  const calling = callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {} },
    signal: caller.signal,
  });

  expect(calling).rejects.toMatchObject({ code: 'timeout' });
});

test('it fails a service call with a deadline whose cancel the supervisor never confirms with an environment error', async () => {
  const ctx = await setupTest();

  const caller = new AbortController();

  const held = Promise.withResolvers<unknown>();

  onTestFinished(() => {
    held.resolve(null);
  });

  ctx.handle.mockImplementationOnce(() => {
    caller.abort();

    return held.promise;
  });

  const calling = callSupervisor({
    socket: ctx.socket,
    request: { service: 'store', method: 'count', args: {}, deadlineAt: Date.now() },
    signal: caller.signal,
  });

  expect(calling).rejects.toMatchObject({ code: 'environment' });
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
