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
