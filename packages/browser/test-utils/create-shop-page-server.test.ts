import { expect, onTestFinished, test } from 'bun:test';
import { createShopPageServer } from './create-shop-page-server.ts';

test('it serves the shop page', async () => {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  const response = await fetch(server.url);
  const body = await response.text();

  expect(body).toContain("<button onclick=\"send('/api/orders', 'Ordered')\">Place order</button>");
});

test('it records the path of each POST', async () => {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  await fetch(new URL('/api/orders', server.url), { method: 'POST' });

  expect(server.posts).toStrictEqual(['/api/orders']);
});
