export interface ShopServer {
  readonly url: string;
  readonly requests: readonly string[];
  readonly stop: () => Promise<void>;
}

// A shop app for tests on a free port: it records each request as `METHOD /path`, answers
// `/api/broken` with 500, a request with `?to=<path>` with a 307 redirect to that path, and every
// other path with JSON that names the request.
export function createShopServer(): ShopServer {
  const requests: string[] = [];

  const answerRequest = (request: Request): Response => {
    const url = new URL(request.url);

    const path = url.pathname;
    const redirectPath = url.searchParams.get('to');

    requests.push(`${request.method} ${path}`);

    if (path === '/api/broken') {
      return Response.json({ error: 'broken' }, { status: 500 });
    }

    if (redirectPath !== null) {
      return new Response(null, { status: 307, headers: { location: redirectPath } });
    }

    return Response.json({ method: request.method, path });
  };

  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: answerRequest });

  return {
    url: server.url.href,
    requests,
    stop: () => server.stop(true),
  };
}
