export async function* readStreamLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder();

  let pending = '';

  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });

    const lines = pending.split('\n');

    pending = lines.pop() ?? '';
    yield* lines;
  }

  pending += decoder.decode();

  if (pending !== '') {
    yield pending;
  }
}
