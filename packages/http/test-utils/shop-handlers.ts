import { HttpResponse, http } from 'msw';

export const SHOP_API_URL = 'https://shop.example';

// Each request the shop answered, as `METHOD /path`, so a test can show that a refused write never
// left the CLI. The test preload clears it after each test.
export const shopRequests: string[] = [];

// The shop app: `/api/broken` answers 500, a request with `?to=<path>` a 307 redirect to that path,
// and every other path JSON that names the request.
export function answerShopRequest(request: Request): Response {
  const url = new URL(request.url);

  const path = url.pathname;
  const redirectPath = url.searchParams.get('to');

  shopRequests.push(`${request.method} ${path}`);

  if (path === '/api/broken') {
    return HttpResponse.json({ error: 'broken' }, { status: 500 });
  }

  if (redirectPath !== null) {
    return new HttpResponse(null, { status: 307, headers: { location: redirectPath } });
  }

  return HttpResponse.json({ method: request.method, path });
}

export const shopHandlers = [
  http.all(`${SHOP_API_URL}/*`, (resolver) => answerShopRequest(resolver.request)),
];
