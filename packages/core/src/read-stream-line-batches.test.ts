import { expect, test } from 'bun:test';
import { readStreamLineBatches } from './read-stream-line-batches.ts';
import { buildChunkStream } from './test-utils/build-chunk-stream.ts';

function setupTest() {
  return {
    readBatches: (chunks: readonly string[]) =>
      Array.fromAsync(readStreamLineBatches(buildChunkStream(chunks))),
  };
}

test('it yields the whole lines of each chunk together, then the last line with no newline', async () => {
  const ctx = setupTest();

  const batches = await ctx.readBatches(['pear\nplum\nfi', 'g\n', 'kiwi']);

  expect(batches).toStrictEqual([['pear', 'plum'], ['fig'], ['kiwi']]);
});

test('it yields nothing for a chunk that ends no line', async () => {
  const ctx = setupTest();

  const batches = await ctx.readBatches(['pe', 'ar\n']);

  expect(batches).toStrictEqual([['pear']]);
});

test('it ends and keeps the lines read so far when the signal aborts while a read is pending', async () => {
  const controller = new AbortController();
  const encoder = new TextEncoder();

  const secondRead = Promise.withResolvers<void>();
  let reads = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull: async (streamController) => {
      reads += 1;

      if (reads === 1) {
        streamController.enqueue(encoder.encode('pear\nplu'));

        return;
      }

      secondRead.resolve();

      await new Promise<void>(() => {});
    },
  });

  const reading = Array.fromAsync(readStreamLineBatches(stream, controller.signal));

  await secondRead.promise;

  controller.abort();

  const batches = await reading;

  expect(batches).toStrictEqual([['pear'], ['plu']]);
});

test('it leaves the stream unlocked once it has read to the end', async () => {
  const stream = buildChunkStream(['pear\n']);

  await Array.fromAsync(readStreamLineBatches(stream));

  expect(stream.locked).toBe(false);
});
