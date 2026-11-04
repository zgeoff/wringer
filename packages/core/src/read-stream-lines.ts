export const streamLineCapChars = 64 * 1024;

// A line longer than the cap keeps its first characters and drops the rest up to its newline, so
// a source that prints without a newline cannot grow the buffer without bound.
export async function* readStreamLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder();

  let pending = '';

  for await (const chunk of stream) {
    const lines = `${pending}${decoder.decode(chunk, { stream: true })}`.split('\n');

    pending = (lines.pop() ?? '').slice(0, streamLineCapChars);
    yield* lines.map((line) => line.slice(0, streamLineCapChars));
  }

  pending = `${pending}${decoder.decode()}`.slice(0, streamLineCapChars);

  if (pending !== '') {
    yield pending;
  }
}
