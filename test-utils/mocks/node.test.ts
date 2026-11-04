import { expect, onTestFinished, test } from 'bun:test';

function setupTest() {
  const app = Bun.serve({ port: 0, hostname: '127.0.0.1', routes: { '/': new Response('shelf') } });

  onTestFinished(() => app.stop(true));

  return { appURL: app.url.href, send: (url: string) => fetch(url) };
}

test('it answers a request to a host that no handler matches with 500', async () => {
  const ctx = setupTest();

  const response = await ctx.send('https://elsewhere.example/');

  expect(response.status).toBe(500);
});

test('it lets a request to a loopback app through', async () => {
  const ctx = setupTest();

  const response = await ctx.send(ctx.appURL);
  const text = await response.text();

  expect(text).toBe('shelf');
});

test('it answers a request to the shop from its handlers', async () => {
  const ctx = setupTest();

  const response = await ctx.send('https://shop.example/api/cart');
  const body: unknown = await response.json();

  expect(body).toStrictEqual({ method: 'GET', path: '/api/cart' });
});
