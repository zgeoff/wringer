import { expect, onTestFinished, test } from 'bun:test';
import { createSlowClosingBrowser } from './create-slow-closing-browser.ts';

async function setupTest() {
  const launched = await createSlowClosingBrowser(300);

  onTestFinished(() => launched.browser.close());

  return launched;
}

test('it keeps a page open until its close has waited the delay', async () => {
  const ctx = await setupTest();
  const context = await ctx.slow.newContext();
  const page = await context.newPage();

  const closing = page.close();
  const openDuringDelay = ctx.pages[0]?.isClosed() === false;

  await closing;

  expect({ openDuringDelay, closed: ctx.pages.map((opened) => opened.isClosed()) }).toStrictEqual({
    openDuringDelay: true,
    closed: [true],
  });
});
