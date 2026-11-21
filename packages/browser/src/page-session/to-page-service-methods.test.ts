import { expect, mock, test } from 'bun:test';
import { toPageServiceMethods } from './to-page-service-methods.ts';
import type { PageHandlers } from './to-page-service-methods.ts';

function setupTest() {
  const clickCalls = mock<PageHandlers['click']>(() =>
    Promise.resolve({ url: 'http://127.0.0.1:4000/cart', title: 'Cart' }),
  );

  const methods = toPageServiceMethods({
    goto: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    snapshot: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop', snapshot: '' }),
    describe: () => Promise.resolve({ ref: 'e1', role: 'button', name: 'Pay' }),
    click: clickCalls,
    check: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop', checked: true }),
    uncheck: () =>
      Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop', checked: false }),
    press: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    hover: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    tabs: () => Promise.resolve({ tabs: [] }),
    tab: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    closeTab: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    activeURL: () => Promise.resolve({ url: 'http://127.0.0.1:4000/' }),
    type: () => Promise.resolve({ url: 'http://127.0.0.1:4000/', title: 'Shop' }),
    screenshot: () => Promise.resolve({ png: '' }),
    status: () => Promise.resolve({ connected: true }),
  });

  return { clickCalls, methods };
}

test('it passes a request that keeps the contract on to its handler', async () => {
  const ctx = setupTest();

  const signal = new AbortController().signal;

  await ctx.methods.click({ role: 'button', name: 'Pay' }, signal);

  expect(ctx.clickCalls).toHaveBeenCalledExactlyOnceWith({ role: 'button', name: 'Pay' }, signal);
});

test('it rejects a request that breaks the contract before its handler runs', () => {
  const ctx = setupTest();

  expect(ctx.methods.click({ role: 'button' }, new AbortController().signal)).rejects.toThrow();
  expect(ctx.clickCalls).not.toHaveBeenCalled();
});
