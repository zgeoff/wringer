import { expect, onTestFinished, test } from 'bun:test';
import { createActor } from 'xstate';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { recordWriterMachine } from './record-writer-machine.ts';

interface Write {
  readonly text: string;
  readonly settle: PromiseWithResolvers<undefined>;
}

function setupTest() {
  const writes: Write[] = [];
  const errors: unknown[] = [];

  const writer = createActor(recordWriterMachine, {
    input: {
      path: 'app.ndjson',
      pendingLimit: 1,
      now: () => new Date('2026-03-01T09:30:00.000Z'),
      write: (text) => {
        const settle = Promise.withResolvers<undefined>();

        writes.push({ text, settle });

        return settle.promise;
      },
      onError: (error) => {
        errors.push(error);
      },
    },
  });

  writer.start();

  onTestFinished(() => {
    writer.stop();
  });

  return {
    writes,
    add: (record: string) => {
      writer.send({ type: 'add', record });
    },
    drain: () => {
      const settle = Promise.withResolvers<null>();

      writer.send({ type: 'drain', settle });

      return settle.promise;
    },
    waitForWrites: (count: number) => waitFor(() => (writes.length === count ? true : null)),
    waitForErrors: (count: number) => waitFor(() => (errors.length === count ? true : null)),
  };
}

test('it keeps the count of dropped lines when the batch that reports them fails to write', async () => {
  const ctx = setupTest();

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
