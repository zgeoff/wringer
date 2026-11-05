import { expect, onTestFinished, test } from 'bun:test';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { createContextRefusingBrowser } from '../test-utils/create-context-refusing-browser.ts';
import { createShopPageServer } from '../test-utils/create-shop-page-server.ts';
import { createSlowClosingBrowser } from '../test-utils/create-slow-closing-browser.ts';
import { startBrowserPage } from './start-browser-page.ts';

function setupTest() {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  const reported: string[] = [];

  const reportError = (message: string): void => {
    reported.push(message);
  };

  return {
    url: server.url,
    posts: server.posts,
    reported,
    revealRestock: server.revealRestock,
    stopServer: server.stop,
    startPage: async (actionTimeoutMs = 5000) => {
      const service = await startBrowserPage({
        launchBrowser: () => chromium.launch({ headless: true }),
        actionTimeoutMs,
        reportError,
      });

      onTestFinished(() => service.stop());

      return service;
    },
    startPageOn: (browser: Browser) =>
      startBrowserPage({
        launchBrowser: () => Promise.resolve(browser),
        actionTimeoutMs: 5000,
        reportError,
      }),
  };
}

test('it fails its start and leaves the browser closed when the run context cannot open', async () => {
  const ctx = setupTest();

  const launched = await createContextRefusingBrowser();

  onTestFinished(() => launched.browser.close());

  const [started] = await Promise.allSettled([ctx.startPageOn(launched.refusing)]);

  expect({ status: started.status, connected: launched.browser.isConnected() }).toStrictEqual({
    status: 'rejected',
    connected: false,
  });
});

test('it closes a browser that no command used at its stop', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.stop();

  expect(service.methods['status']?.(null, new AbortController().signal)).resolves.toStrictEqual({
    connected: false,
  });
});

test('it answers a command after a stopped command and a closed browser with an environment error', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  const stopped = new AbortController();

  const snapshot = service.methods['snapshot']?.(null, stopped.signal);

  stopped.abort();

  await snapshot?.catch(() => null);
  await service.stop();

  expect(service.methods['snapshot']?.(null, new AbortController().signal)).rejects.toMatchObject({
    code: 'environment',
  });
});

test('it refuses an action whose deadline passed before the browser started it', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  expect(service.methods['snapshot']?.(null, AbortSignal.abort())).rejects.toMatchObject({
    code: 'timeout',
  });
});

test('it answers an element that never appears within the action timeout with a timeout error and the snapshot hint', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage(300);

  await service.methods['goto']?.({ url: ctx.url }, new AbortController().signal);

  const click = service.methods['click']?.(
    { role: 'button', name: 'Gift wrap' },
    AbortSignal.timeout(5000),
  );

  expect(click).rejects.toMatchObject({
    code: 'timeout',
    hint: 'Run `browser snapshot` to see the page as it is now.',
  });
});

test('it answers a command after the browser closed with an environment error', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.stop();

  expect(service.methods['snapshot']?.(null, new AbortController().signal)).rejects.toMatchObject({
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

test('it fails a cancelled command only once its page has closed', async () => {
  const ctx = setupTest();

  const launched = await createSlowClosingBrowser(500);

  onTestFinished(() => launched.browser.close());

  const service = await ctx.startPageOn(launched.slow);

  await service.methods['goto']?.({ url: ctx.url }, new AbortController().signal);

  const [clicked] = await Promise.allSettled([
    service.methods['click']?.({ role: 'button', name: 'Restock' }, AbortSignal.timeout(300)),
  ]);

  expect({ clicked, staleClosed: launched.pages[0]?.isClosed() }).toStrictEqual({
    clicked: { status: 'rejected', reason: expect.objectContaining({ code: 'timeout' }) },
    staleClosed: true,
  });
});

test('it reports a failed reload of the replacement page and keeps the page for the next command', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.methods['goto']?.({ url: ctx.url }, new AbortController().signal);
  await ctx.stopServer();

  await service.methods['click']?.(
    { role: 'button', name: 'Restock' },
    AbortSignal.timeout(300),
  )?.catch(() => null);

  const status = await service.methods['snapshot']?.(null, AbortSignal.timeout(5000));

  expect({ reported: ctx.reported, status }).toStrictEqual({
    reported: [expect.stringContaining(`The replacement page could not reload ${ctx.url}: `)],
    status: { url: expect.any(String), title: expect.any(String), snapshot: expect.any(String) },
  });
});

test('it keeps the cookies of a page that a timed-out command replaced', async () => {
  const ctx = setupTest();

  const service = await ctx.startPage();

  await service.methods['goto']?.(
    { url: new URL('/basket/fill', ctx.url).href },
    new AbortController().signal,
  );

  await service.methods['click']?.(
    { role: 'button', name: 'Restock' },
    AbortSignal.timeout(300),
  )?.catch(() => null);

  const basket = await service.methods['goto']?.(
    { url: new URL('/basket', ctx.url).href },
    AbortSignal.timeout(5000),
  );

  expect(basket).toStrictEqual({ url: new URL('/basket', ctx.url).href, title: 'Basket: mugs' });
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
