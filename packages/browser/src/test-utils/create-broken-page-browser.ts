import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

export interface BrokenPageBrowser {
  // The launched browser, for the test to close.
  readonly browser: Browser;

  // The same browser, except that each page's `close` rejects and leaves the page open, or that
  // each page after a context's first fails to open.
  readonly broken: Browser;
}

type ContextOptions = Parameters<Browser['newContext']>[0];

export async function createBrokenPageBrowser(
  breaks: 'close' | 'reopen',
): Promise<BrokenPageBrowser> {
  const browser = await chromium.launch({ headless: true });

  const wrapPage = (page: Page): Page =>
    breaks === 'close'
      ? replaceMethod(page, 'close', () => Promise.reject(new Error('The page refused to close.')))
      : page;

  const wrapContext = (context: BrowserContext): BrowserContext => {
    let opened = 0;

    const openPage = async (): Promise<Page> => {
      opened += 1;

      if (breaks === 'reopen' && opened > 1) {
        throw new Error('The context refused a new page.');
      }

      const page = await context.newPage();

      return wrapPage(page);
    };

    return replaceMethod(context, 'newPage', openPage);
  };

  const openContext = async (options?: ContextOptions): Promise<BrowserContext> => {
    const context = await browser.newContext(options);

    return wrapContext(context);
  };

  return { browser, broken: replaceMethod(browser, 'newContext', openContext) };
}

// A method then runs with the target as `this`, and reads the target's state through it.
function replaceMethod<Target extends object>(
  target: Target,
  name: string,
  replacement: unknown,
): Target {
  return new Proxy(target, {
    get: (object, key) => {
      if (key === name) {
        return replacement;
      }

      const value: unknown = Reflect.get(object, key, object);

      return value;
    },
  });
}
