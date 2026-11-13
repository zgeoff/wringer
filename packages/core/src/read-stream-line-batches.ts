export const streamLineCapChars = 64 * 1024;

// Yields the whole lines of each chunk together, so a caller can handle a chunk's lines in one
// step. A line longer than the cap keeps its first characters and drops the rest up to its
// newline, so a source that prints without a newline cannot grow the buffer without bound.
export async function* readStreamLineBatches(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<readonly string[], void, undefined> {
  const decoder = new TextDecoder();

  // An async iterator cannot be cancelled while a read is pending, so the reader is taken by hand.
  // Aborting `signal` cancels the stream and keeps the lines read so far.
  const reader = stream.getReader();

  const cancel = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {
      // A stream that is already closed or errored has nothing left to release.
    }
  };

  const onAbort = (): void => {
    void cancel();
  };

  signal?.addEventListener('abort', onAbort, { once: true });

  if (signal?.aborted === true) {
    onAbort();
  }

  let pending = '';

  try {
    for (;;) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      const lines = `${pending}${decoder.decode(chunk.value, { stream: true })}`.split('\n');

      pending = (lines.pop() ?? '').slice(0, streamLineCapChars);

      if (lines.length > 0) {
        yield lines.map((line) => line.slice(0, streamLineCapChars));
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);

    await cancel();
  }

  pending = `${pending}${decoder.decode()}`.slice(0, streamLineCapChars);

  if (pending !== '') {
    yield [pending];
  }
}
