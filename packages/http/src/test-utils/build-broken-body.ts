export function buildBrokenBody(prefix: string, reason: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.error(new Error(reason));
    },
  });
}
