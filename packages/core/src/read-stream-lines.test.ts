import { expect, test } from 'bun:test';
import { readStreamLines, streamLineCapChars } from './read-stream-lines.ts';

function setupTest() {
  const encoder = new TextEncoder();

  return {
    readLines: (chunks: readonly string[]) =>
      Array.fromAsync(
        readStreamLines(
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
