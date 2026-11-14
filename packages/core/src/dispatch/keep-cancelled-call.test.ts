import { expect, test } from 'bun:test';
import { keepCancelledCall } from './keep-cancelled-call.ts';

function setupTest() {
  const cancelled: Promise<unknown>[] = [];

  const deadline = new AbortController();

  const answer = Promise.withResolvers<unknown>();

  keepCancelledCall(cancelled, answer.promise, deadline.signal);

  return {
    cancelled,
    call: answer.promise,
    answer: (value: unknown) => {
      answer.resolve(value);
    },
    abort: () => {
      deadline.abort();
    },
  };
}

test('it keeps a call that still runs when its signal aborts', () => {
  const ctx = setupTest();

  ctx.abort();

  expect(ctx.cancelled).toStrictEqual([ctx.call]);
});

test('it drops a call that settled before its signal aborted', async () => {
  const ctx = setupTest();

  ctx.answer({ notes: 2 });

  await ctx.call;

  await Promise.resolve();

  ctx.abort();

  expect(ctx.cancelled).toStrictEqual([]);
});
