import { expect, test } from 'bun:test';
import { SHOP_API_URL, answerShopRequest, shopRequests } from './shop-handlers.ts';

test('it answers a path with JSON that names the request, and records it', async () => {
  const response = answerShopRequest(new Request(`${SHOP_API_URL}/api/cart`));

  const body: unknown = await response.json();

  expect({ status: response.status, body, requests: shopRequests }).toStrictEqual({
    status: 200,
    body: { method: 'GET', path: '/api/cart' },
    requests: ['GET /api/cart'],
  });
});

test('it answers the broken path with 500', () => {
  const response = answerShopRequest(new Request(`${SHOP_API_URL}/api/broken`));

  expect(response.status).toBe(500);
});

test('it answers a request with a `to` parameter with a 307 to that path', () => {
  const request = new Request(`${SHOP_API_URL}/api/search?to=/api/orders`, { method: 'POST' });

  const response = answerShopRequest(request);

  expect({ status: response.status, location: response.headers.get('location') }).toStrictEqual({
    status: 307,
    location: '/api/orders',
  });
});
