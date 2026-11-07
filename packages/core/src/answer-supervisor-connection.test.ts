import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { answerSupervisorConnection } from './answer-supervisor-connection.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

// The stack closes both ends of the socket and the listener before it removes their folder.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'answer-supervisor-connection');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const path = join(directory, 'supervisor.sock');
  const accepted = Promise.withResolvers<Socket>();

  const server = createServer((connection) => {
    accepted.resolve(connection);
  });

  server.listen(path);

  stack.defer(() => {
    server.close();
  });

  await once(server, 'listening');

  const client = createConnection(path);

  stack.defer(() => {
    client.destroy();
  });

  const connection = await accepted.promise;

  stack.defer(() => {
    connection.destroy();
  });

  const reports: unknown[] = [];

  const closing = new AbortController();

  return {
    reports,
    client,
    connection,
    close: () => {
      closing.abort();
    },
    answer: () =>
      answerSupervisorConnection(
        connection,
        {
          answerRequest: () => Promise.resolve({ notes: 2 }),
          onTransportError: (error) => {
            reports.push(error);
          },
        },
        closing.signal,
      ),
  };
}

test('it ends a connection that sent no request once the socket closes', async () => {
  const ctx = await setupTest();

  const answering = ctx.answer();

  ctx.close();

  await answering;

  expect(ctx.connection.destroyed).toBeTrue();
});

test('it reports a connection that fails before its request, once, and settles', async () => {
  const ctx = await setupTest();

  const answering = ctx.answer();

  const reset = new Error('read ECONNRESET');

  ctx.connection.destroy(reset);

  await answering;

  expect(ctx.reports).toStrictEqual([reset]);
});

test('it reports a connection that fails after its answer, once, and throws nothing', async () => {
  const ctx = await setupTest();

  const answering = ctx.answer();

  ctx.client.write('{"service":"shelf","method":"count","args":null}\n');

  await answering;

  const broken = new Error('write EPIPE');

  const closed = once(ctx.connection, 'close');

  ctx.connection.destroy(broken);

  // `once` rejects with the error the connection emits before it closes.
  await Promise.allSettled([closed]);

  expect(ctx.reports).toStrictEqual([broken]);
});
