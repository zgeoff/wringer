// A loopback port that nothing listens on: the port the system gave a server that has stopped.
export async function readUnusedPort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: answerEmpty });
  const port = server.port ?? 0;

  await server.stop(true);

  return port;
}

function answerEmpty(): Response {
  return new Response();
}
