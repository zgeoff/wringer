import { expect, onTestFinished, test } from 'bun:test';
import { createShopPageServer } from '../test-utils/create-shop-page-server.ts';
import { startBrowserPage } from './start-browser-page.ts';

function setupTest() {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  return {
    url: server.url,
    posts: server.posts,
    revealRestock: server.revealRestock,
    startPage: async () => {
      const service = await startBrowserPage({ actionTimeoutMs: 5000 });

      onTestFinished(() => service.stop());

      return service;
    },
  };
}

test('it stops a browser that no command used', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  expect(service.stop()).resolves.toBeUndefined();
});

test('it answers a command after a stopped command and a closed browser with an environment error', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  const stopped = new AbortController();

  const snapshot = service.methods['snapshot']?.({}, stopped.signal);

  stopped.abort();

  await snapshot?.catch(() => null);
  await service.stop();

  expect(service.methods['snapshot']?.({}, new AbortController().signal)).rejects.toMatchObject({
    code: 'environment',
  });
});

test('it refuses an action whose deadline passed before the browser started it', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  expect(service.methods['snapshot']?.({}, AbortSignal.abort())).rejects.toMatchObject({
    code: 'timeout',
  });
});

test('it answers a command after the browser closed with an environment error', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.stop();

  expect(service.methods['snapshot']?.({}, new AbortController().signal)).rejects.toMatchObject({
    code: 'environment',
  });
});

test('it runs a command queued behind a timed-out click on the reopened page', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.methods['goto']?.({ url: ctx.url }, new AbortController().signal);

  const late = service.methods['click']?.(
    { role: 'button', name: 'Restock' },
    AbortSignal.timeout(300),
  );

  const queued = service.methods['click']?.(
    { role: 'button', name: 'Restock' },
    AbortSignal.timeout(5000),
  );

  await late?.catch(() => null);

  ctx.revealRestock();

  const [clicked] = await Promise.allSettled([queued]);

  expect({ status: clicked.status, posts: ctx.posts }).toStrictEqual({
    status: 'fulfilled',
    posts: ['/api/restock'],
  });
});

test('it refuses a queued command whose deadline passed while it waited, before it starts', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.methods['goto']?.({ url: ctx.url }, new AbortController().signal);

  const click = service.methods['click']?.(
    { role: 'button', name: 'Restock' },
    AbortSignal.timeout(300),
  );

  const order = service.methods['click']?.(
    { role: 'button', name: 'Place order' },
    AbortSignal.timeout(100),
  );

  const [, ordered] = await Promise.allSettled([click, order]);

  expect({ ordered, posts: ctx.posts }).toStrictEqual({
    ordered: { status: 'rejected', reason: expect.objectContaining({ code: 'timeout' }) },
    posts: [],
  });
});
