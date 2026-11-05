import { expect, mock, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import type { SupervisorRequestHandler } from './answer-supervisor-connection.ts';
import { callSupervisor } from './call-supervisor.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'supervisor-socket');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const socket = join(directory, 'run.sock');

  return {
    listen: async (answerRequest: SupervisorRequestHandler) => {
      const server = await listenSupervisorSocket({
        path: socket,
        answerRequest,
        onTransportError: mock(),
      });

      stack.defer(() => {
        server.close();
      });
    },
    call: (method: string, signal: AbortSignal) =>
      callSupervisor({ socket, request: { service: 'shelf', method, args: null }, signal }),
  };
}

test('it answers a request with the result of its handler', async () => {
  const ctx = await setupTest();

  await ctx.listen((request) => Promise.resolve({ method: request.method }));

  const answer = await ctx.call('count', AbortSignal.timeout(5000));

  expect(answer).toStrictEqual({ method: 'count' });
});

test('it aborts the handler signal when the caller stops waiting', async () => {
  const ctx = await setupTest();

  const started = Promise.withResolvers<undefined>();
  const aborted = Promise.withResolvers<boolean>();

  await ctx.listen(async (_request, signal) => {
    signal.addEventListener('abort', () => {
      aborted.resolve(true);
    });

    started.resolve(undefined);

    await aborted.promise;

    return null;
  });

  const controller = new AbortController();

  const calling = ctx.call('restock', controller.signal);

  await started.promise;

  controller.abort();

  const [settled, handlerAborted] = await Promise.all([
    Promise.allSettled([calling]),
    aborted.promise,
  ]);

  expect({ status: settled[0].status, handlerAborted }).toStrictEqual({
    status: 'rejected',
    handlerAborted: true,
  });
});
