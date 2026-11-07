import { expect, test } from 'bun:test';
import { buildChunkStream } from './build-chunk-stream.ts';

test('it sends each text as its own chunk, in order, then ends', async () => {
  const chunks = await Array.fromAsync(buildChunkStream(['kale\nle', 'eks']));

  expect(chunks.map((chunk) => new TextDecoder().decode(chunk))).toStrictEqual(['kale\nle', 'eks']);
});

test('it ends at once with no texts', async () => {
  const chunks = await Array.fromAsync(buildChunkStream([]));

  expect(chunks).toStrictEqual([]);
});
