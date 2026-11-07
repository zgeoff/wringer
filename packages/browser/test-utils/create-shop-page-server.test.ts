import { expect, onTestFinished, test } from 'bun:test';
import { createShopPageServer } from './create-shop-page-server.ts';

function setupTest() {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  return {
    server,
    request: (path: string, init: RequestInit = {}) => fetch(new URL(path, server.url), init),
  };
}

test('it serves the shop page', async () => {
  const ctx = setupTest();

  const response = await ctx.request('/');
  const body = await response.text();

  expect(body).toContain("<button onclick=\"send('/api/orders', 'Ordered')\">Place order</button>");
});

test('it sets the basket cookie on the first fill only', async () => {
  const ctx = setupTest();

  const first = await ctx.request('/basket/fill');
  const second = await ctx.request('/basket/fill');

  expect([first.headers.get('set-cookie'), second.headers.get('set-cookie')]).toStrictEqual([
    'basket=mugs; Path=/',
    null,
  ]);
});

test('it puts the basket cookie in the basket title', async () => {
  const ctx = setupTest();

  const response = await ctx.request('/basket', { headers: { cookie: 'basket=mugs' } });
  const body = await response.text();

  expect(body).toBe('<!doctype html><title>Basket: mugs</title>');
});

test('it counts each load of the page', async () => {
  const ctx = setupTest();

  await ctx.request('/');
  await ctx.request('/');

  expect(ctx.server.pageLoads()).toBe(2);
});

test('it answers an unknown path with 404 and counts no page load', async () => {
  const ctx = setupTest();

  const response = await ctx.request('/favicon.ico');

  expect({ status: response.status, pageLoads: ctx.server.pageLoads() }).toStrictEqual({
    status: 404,
    pageLoads: 0,
  });
});

test('it records the path of each POST', async () => {
  const ctx = setupTest();

  await ctx.request('/api/orders', { method: 'POST' });

  expect(ctx.server.posts).toStrictEqual(['/api/orders']);
});

test('it answers that the Restock button is ready once the test reveals it', async () => {
  const ctx = setupTest();

  ctx.server.revealRestock();

  const response = await ctx.request('/api/restock-ready');
  const ready: unknown = await response.json();

  expect(ready).toBeTrue();
});
