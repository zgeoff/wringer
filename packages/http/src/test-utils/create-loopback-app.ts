import { onTestFinished } from 'bun:test';

export interface LoopbackApp {
  readonly url: string;
  readonly stop: () => Promise<void>;
}

// An app on a loopback port that answers every path with an empty 200 until the test stops it.
// After the stop, nothing listens on the port, so a request there is refused.
export function createLoopbackApp(): LoopbackApp {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: answerEmpty });

  onTestFinished(() => server.stop(true));

  return { url: server.url.origin, stop: () => server.stop(true) };
}

function answerEmpty(): Response {
  return new Response();
}
