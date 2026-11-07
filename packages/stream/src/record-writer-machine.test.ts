import { expect, onTestFinished, test } from 'bun:test';
import { buildStubClock } from '@wringer/core/test-utils/build-stub-clock.ts';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createActor } from 'xstate';
import { recordWriterMachine } from './record-writer-machine.ts';

interface Write {
  readonly text: string;
  readonly settle: PromiseWithResolvers<undefined>;
}

function setupTest() {
  const writes: Write[] = [];
  const errors: unknown[] = [];

  // The number of writes started when each recovery was reported.
  const recoveries: number[] = [];
  const clock = buildStubClock();

  const writer = createActor(recordWriterMachine, {
    input: {
      path: 'app.ndjson',
      pendingLimit: 1,
      now: clock.now,
      write: (text) => {
        const settle = Promise.withResolvers<undefined>();

        writes.push({ text, settle });

        return settle.promise;
      },
      onError: (error) => {
        errors.push(error);
      },
      onRecovered: () => {
        recoveries.push(writes.length);
      },
    },
  });

  writer.start();

  onTestFinished(() => {
    writer.stop();
  });

  return {
    clock,
    writes,
    recoveries,
    add: (record: string) => {
      writer.send({ type: 'add', record });
    },
    drain: () => {
      const settle = Promise.withResolvers<null>();

      writer.send({ type: 'drain', settle });

      return settle.promise;
    },
    waitForWrites: (count: number) =>
      waitFor(() => {
        invariant(writes.length === count, `The writer has not made ${count} writes yet.`);
      }),
    waitForErrors: (count: number) =>
      waitFor(() => {
        invariant(errors.length === count, `The writer has not reported ${count} errors yet.`);
      }),
  };
}

test('it reports a recovery once, when a write succeeds after one that failed', async () => {
  const ctx = setupTest();

  ctx.add('pear');
  ctx.writes[0]?.settle.resolve(undefined);
  ctx.add('plum');

  await ctx.waitForWrites(2);

  ctx.writes[1]?.settle.reject(new Error('the disk is full'));

  await ctx.waitForErrors(1);

  ctx.add('fig');

  await ctx.waitForWrites(3);

  ctx.writes[2]?.settle.resolve(undefined);
  ctx.add('kiwi');

  await ctx.waitForWrites(4);

  ctx.writes[3]?.settle.resolve(undefined);

  await ctx.drain();

  expect(ctx.recoveries).toStrictEqual([3]);
});

test('it keeps the count of dropped lines when the batch that reports them fails to write', async () => {
  const ctx = setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');
  ctx.add('pear');
  ctx.add('plum');
  ctx.add('fig');
  ctx.add('kiwi');
  ctx.writes[0]?.settle.resolve(undefined);

  await ctx.waitForWrites(2);

  ctx.writes[1]?.settle.reject(new Error('the disk is full'));

  await ctx.waitForErrors(1);

  const draining = ctx.drain();

  await ctx.waitForWrites(3);

  ctx.writes[2]?.settle.resolve(undefined);

  await draining;

  const notice = JSON.stringify({
    at: '2026-03-01T09:30:00.000Z',
    line: '[wringer] the recorder dropped 2 lines while it caught up',
  });

  expect(ctx.writes.map((write) => write.text)).toStrictEqual([
    'pear\n',
    `plum\n${notice}\n`,
    `plum\n${notice}\n`,
  ]);
});
