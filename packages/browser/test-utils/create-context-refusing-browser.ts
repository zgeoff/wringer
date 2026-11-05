import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

export interface ContextRefusingBrowser {
  // The launched browser, to read its connection from after a caller had the stand-in.
  readonly browser: Browser;

  // The same browser, except that `newContext` rejects while the browser stays open.
  readonly refusing: Browser;
}

export async function createContextRefusingBrowser(): Promise<ContextRefusingBrowser> {
  const browser = await chromium.launch({ headless: true });

  const refusing = new Proxy(browser, {
    get: (target, key) => {
      if (key === 'newContext') {
        return () => Promise.reject(new Error('The browser refused a new context.'));
      }

      const value: unknown = Reflect.get(target, key, target);

      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return { browser, refusing };
}
