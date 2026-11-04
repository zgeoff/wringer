import { HttpResponse, http } from 'msw';

export const SHOP_API_URL = 'https://shop.example';

// Each request the shop answered, as `METHOD /path`, so a test can show that a refused write never
// left the CLI. The test preload clears it after each test.
export const shopRequests: string[] = [];

// The shop app: `/api/broken` answers 500, and every other path answers JSON that names the request.
export const shopHandlers = [
  http.all(`${SHOP_API_URL}/api/broken`, (resolver) => {
    recordShopRequest(resolver.request);

    return HttpResponse.json({ error: 'broken' }, { status: 500 });
  }),
  http.all(`${SHOP_API_URL}/*`, (resolver) => {
    const path = recordShopRequest(resolver.request);

    return HttpResponse.json({ method: resolver.request.method, path });
  }),
];

function recordShopRequest(request: Request): string {
  const path = new URL(request.url).pathname;

  shopRequests.push(`${request.method} ${path}`);

  return path;
}
