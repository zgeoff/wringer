import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { answerSupervisorConnection } from './answer-supervisor-connection.ts';

function setupTest() {
  const reports: unknown[] = [];

  return {
    reports,
    answer: (connection: PassThrough) =>
      answerSupervisorConnection(connection, {
        answerRequest: () => Promise.resolve({ notes: 2 }),
        onTransportError: (error) => {
          reports.push(error);
        },
      }),
  };
}

test('it reports a connection that fails before its request, once, and settles', async () => {
  const ctx = setupTest();

  const connection = new PassThrough();

  const answering = ctx.answer(connection);

  const reset = new Error('read ECONNRESET');

  connection.destroy(reset);

  await answering;

  expect(ctx.reports).toStrictEqual([reset]);
});

test('it reports a connection that fails after its answer, once, and throws nothing', async () => {
  const ctx = setupTest();

  const connection = new PassThrough();

  const answering = ctx.answer(connection);

  connection.write('{"service":"shelf","method":"count","args":null}\n');

  await answering;

  const broken = new Error('write EPIPE');

  const closed = once(connection, 'close');

  connection.destroy(broken);

  // `once` rejects with the error the connection emits before it closes.
  await Promise.allSettled([closed]);

  expect(ctx.reports).toStrictEqual([broken]);
});
