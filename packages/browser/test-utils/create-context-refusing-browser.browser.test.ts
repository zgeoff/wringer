import { expect, onTestFinished, test } from 'bun:test';
import { createContextRefusingBrowser } from './create-context-refusing-browser.ts';

async function setupTest() {
  const launched = await createContextRefusingBrowser();

  onTestFinished(() => launched.browser.close());

  return launched;
}

test('it refuses a new context while the browser stays open', async () => {
  const ctx = await setupTest();
  const [opened] = await Promise.allSettled([ctx.refusing.newContext()]);

  expect({ status: opened.status, connected: ctx.browser.isConnected() }).toStrictEqual({
    status: 'rejected',
    connected: true,
  });
});

test('it closes the launched browser when the caller closes the stand-in', async () => {
  const ctx = await setupTest();

  await ctx.refusing.close();

  expect(ctx.browser.isConnected()).toBe(false);
});
