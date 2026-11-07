import { readStreamLineBatches } from './read-stream-line-batches.ts';

export { streamLineCapChars } from './read-stream-line-batches.ts';

export async function* readStreamLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  for await (const batch of readStreamLineBatches(stream)) {
    yield* batch;
  }
}
