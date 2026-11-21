import { HttpResponse, http } from 'msw';

export const SHOP_API_URL = 'https://shop.example';
export const ADMIN_API_URL = 'https://admin.example';

// Each request the shop answered, as `METHOD /path`, so a test can show that a refused write never
// left the CLI. The test preload clears it after each test.
export const shopRequests: string[] = [];

// The shop app: `/api/broken` answers 500, and every other path answers JSON that names the request.
// The admin app answers JSON that names the request, and records it as `METHOD admin /path`.
export const shopHandlers = [
  http.all(`${ADMIN_API_URL}/*`, (resolver) => {
    const path = new URL(resolver.request.url).pathname;

    shopRequests.push(`${resolver.request.method} admin ${path}`);

    return HttpResponse.json({ method: resolver.request.method, path, app: 'admin' });
  }),
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
