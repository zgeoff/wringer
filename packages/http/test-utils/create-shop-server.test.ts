import { expect, onTestFinished, test } from 'bun:test';
import { createShopServer } from './create-shop-server.ts';

test('it records each request and answers with JSON that names it', async () => {
  const server = createShopServer();

  onTestFinished(() => server.stop());

  const response = await fetch(new URL('/api/cart', server.url), { method: 'POST' });
  const body: unknown = await response.json();

  expect({ body, requests: server.requests }).toStrictEqual({
    body: { method: 'POST', path: '/api/cart' },
    requests: ['POST /api/cart'],
  });
});

test('it redirects a request with a to parameter to that path', async () => {
  const server = createShopServer();

  onTestFinished(() => server.stop());

  const response = await fetch(new URL('/api/search?to=/api/orders', server.url), {
    method: 'POST',
    redirect: 'manual',
  });

  expect({ status: response.status, location: response.headers.get('location') }).toStrictEqual({
    status: 307,
    location: '/api/orders',
  });
});

test('it answers /api/broken with 500', async () => {
  const server = createShopServer();

  onTestFinished(() => server.stop());

  const response = await fetch(new URL('/api/broken', server.url));

  expect(response.status).toBe(500);
});
