import { expect, test } from 'bun:test';
import { SHOP_API_URL, shopRequests } from './shop-handlers.ts';

test('it answers a path with JSON that names the request, and records it', async () => {
  const response = await fetch(`${SHOP_API_URL}/api/cart`);
  const body: unknown = await response.json();

  expect({ status: response.status, body, requests: shopRequests }).toStrictEqual({
    status: 200,
    body: { method: 'GET', path: '/api/cart' },
    requests: ['GET /api/cart'],
  });
});

test('it answers the broken path with 500, and records it', async () => {
  const response = await fetch(`${SHOP_API_URL}/api/broken`, { method: 'POST' });

  expect({ status: response.status, requests: shopRequests }).toStrictEqual({
    status: 500,
    requests: ['POST /api/broken'],
  });
});
