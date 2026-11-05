import { expect, test } from 'bun:test';
import { readStreamLineBatches } from './read-stream-line-batches.ts';

function setupTest() {
  const encoder = new TextEncoder();

  return {
    readBatches: (chunks: readonly string[]) =>
      Array.fromAsync(
        readStreamLineBatches(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
              }

              controller.close();
            },
          }),
        ),
      ),
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
