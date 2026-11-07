import { expect, onTestFinished, test } from 'bun:test';
import { createBrokenPageBrowser } from './create-broken-page-browser.ts';

test('it rejects each page close and leaves the page open when it breaks close', async () => {
  const launched = await createBrokenPageBrowser('close');

  onTestFinished(() => launched.browser.close());

  const context = await launched.broken.newContext();
  const page = await context.newPage();
  const [closed] = await Promise.allSettled([page.close()]);

  expect({ closed, open: !page.isClosed() }).toStrictEqual({
    closed: { status: 'rejected', reason: new Error('The page refused to close.') },
    open: true,
  });
});

test("it opens a context's first page and refuses the next when it breaks reopen", async () => {
  const launched = await createBrokenPageBrowser('reopen');

  onTestFinished(() => launched.browser.close());

  const context = await launched.broken.newContext();
  const first = await context.newPage();
  const [second] = await Promise.allSettled([context.newPage()]);

  expect({ firstOpen: !first.isClosed(), second }).toStrictEqual({
    firstOpen: true,
    second: { status: 'rejected', reason: new Error('The context refused a new page.') },
  });
});
