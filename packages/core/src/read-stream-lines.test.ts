import { expect, test } from 'bun:test';
import { buildChunkStream } from '../test-utils/build-chunk-stream.ts';
import { readStreamLines, streamLineCapChars } from './read-stream-lines.ts';

function setupTest() {
  return {
    readLines: (chunks: readonly string[]) =>
      Array.fromAsync(readStreamLines(buildChunkStream(chunks))),
  };
}

test('it splits the chunks into lines, with a last line that has no newline', async () => {
  const ctx = setupTest();

  const lines = await ctx.readLines(['kale\nle', 'eks\nchard']);

  expect(lines).toStrictEqual(['kale', 'leeks', 'chard']);
});

test('it cuts a line that runs past the cap and keeps the next line whole', async () => {
  const ctx = setupTest();
  const chunk = 'x'.repeat(streamLineCapChars);

  const lines = await ctx.readLines([chunk, chunk, chunk, '\nkale\n']);

  expect(lines).toStrictEqual(['x'.repeat(streamLineCapChars), 'kale']);
});
