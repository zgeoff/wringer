import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

export interface SlowClosingBrowser {
  // The launched browser, for the test to close.
  readonly browser: Browser;

  // The same browser, except that each page's `close` waits `closeDelayMs` before it closes.
  readonly slow: Browser;

  // Each page the stand-in opened, in order.
  readonly pages: readonly Page[];
}

type PageCloseOptions = Parameters<Page['close']>[0];

type ContextOptions = Parameters<Browser['newContext']>[0];

export async function createSlowClosingBrowser(closeDelayMs: number): Promise<SlowClosingBrowser> {
  const browser = await chromium.launch({ headless: true });

  const pages: Page[] = [];

  const wrapPage = (page: Page): Page => {
    const closeSlowly = async (options?: PageCloseOptions): Promise<void> => {
      await Bun.sleep(closeDelayMs);
      await page.close(options);
    };

    return replaceMethod(page, 'close', closeSlowly);
  };

  const wrapContext = (context: BrowserContext): BrowserContext => {
    const openRecordedPage = async (): Promise<Page> => {
      const page = await context.newPage();

      pages.push(page);

      return wrapPage(page);
    };

    return replaceMethod(context, 'newPage', openRecordedPage);
  };

  const openSlowContext = async (options?: ContextOptions): Promise<BrowserContext> => {
    const context = await browser.newContext(options);

    return wrapContext(context);
  };

  return { browser, slow: replaceMethod(browser, 'newContext', openSlowContext), pages };
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
