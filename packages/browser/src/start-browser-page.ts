import { WringerError } from '@wringer/core';
import type { ServiceInstance } from '@wringer/core';
import { chromium, errors } from 'playwright-core';
import type { Locator, Page } from 'playwright-core';
import { z } from 'zod';
import { findSnapshotElement } from './find-snapshot-element.ts';

export interface BrowserPageOptions {
  readonly executablePath?: string | undefined;
  readonly actionTimeoutMs: number;
}

const refSchema = z.strictObject({ ref: z.string().min(1) });
const roleSchema = z.strictObject({ role: z.string().min(1), name: z.string() });
const elementSchema = z.union([refSchema, roleSchema]);
const gotoSchema = z.strictObject({ url: z.url({ protocol: /^https?$/v }) });
const typeSchema = z.strictObject({ element: elementSchema, value: z.string() });

// One headless browser and one page per run, held by the run's supervisor so the page keeps its
// state between commands. `describe` reads the last snapshot, because a new snapshot renumbers
// every ref.
export async function startBrowserPage(options: BrowserPageOptions): Promise<ServiceInstance> {
  const browser = await chromium.launch({
    headless: true,
    ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
  });

  const openPage = async (): Promise<Page> => {
    const opened = await browser.newPage();

    opened.setDefaultTimeout(options.actionTimeoutMs);

    return opened;
  };

  let pageReady = openPage();
  let lastSnapshot = '';

  // Playwright cannot cancel one action, so a caller that stops waiting gets the page closed under
  // its action, and the next command a new page at the same URL; a late click never lands.
  const runPageAction = async <T>(
    signal: AbortSignal,
    action: (page: Page) => Promise<T>,
  ): Promise<T> => {
    const page = await pageReady;

    const reopen = (): void => {
      pageReady = reopenPage(page, openPage);
    };

    signal.addEventListener('abort', reopen, { once: true });

    try {
      return await action(page);
    } catch (error) {
      throw toPageError(error);
    } finally {
      signal.removeEventListener('abort', reopen);
    }
  };

  return {
    methods: {
      goto: (args, signal) =>
        runPageAction(signal, async (page) => {
          const parsed = gotoSchema.parse(args);

          await page.goto(parsed.url);

          return readPageState(page);
        }),
      snapshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          lastSnapshot = await page.ariaSnapshot({ mode: 'ai' });

          const state = await readPageState(page);

          return { ...state, snapshot: lastSnapshot };
        }),
      describe: (args) => {
        const parsed = refSchema.parse(args);
        const element = findSnapshotElement(lastSnapshot, parsed.ref);

        if (element === null) {
          return Promise.reject(
            new WringerError('usage', {
              message: `The last snapshot has no element ${parsed.ref}.`,
              hint: 'Run `browser snapshot`, then use a ref it printed.',
            }),
          );
        }

        return Promise.resolve({ ref: parsed.ref, ...element });
      },
      click: (args, signal) =>
        runPageAction(signal, async (page) => {
          await locateElement(page, elementSchema.parse(args)).click();

          return readPageState(page);
        }),
      type: (args, signal) =>
        runPageAction(signal, async (page) => {
          const parsed = typeSchema.parse(args);

          await locateElement(page, parsed.element).fill(parsed.value);

          return readPageState(page);
        }),
      screenshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          const png = await page.screenshot({ fullPage: true });

          return { png: png.toString('base64') };
        }),
      status: () => Promise.resolve({ connected: browser.isConnected() }),
    },
    stop: () => browser.close(),
  };
}

async function reopenPage(stale: Page, openPage: () => Promise<Page>): Promise<Page> {
  const url = stale.url();

  const page = await openPage();

  await stale.close();

  // A reload that fails leaves the new page blank, and the next `goto` recovers it; the page itself
  // must still come back, or every later command would fail.
  if (url !== 'about:blank') {
    await page.goto(url).catch(() => null);
  }

  return page;
}

// Playwright reports a missing element as a timeout and anything else as a plain error; both reach
// the caller as one of the envelope's error codes.
function toPageError(error: unknown): unknown {
  if (error instanceof WringerError || error instanceof z.ZodError) {
    return error;
  }

  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);

  if (error instanceof errors.TimeoutError) {
    return new WringerError('timeout', {
      message: `The browser gave up: ${message}`,
      hint: 'Run `browser snapshot` to see the page as it is now.',
    });
  }

  return new WringerError('environment', { message: `The browser failed: ${message}` });
}

export const pageStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
});

async function readPageState(page: Page): Promise<z.infer<typeof pageStateSchema>> {
  const title = await page.title();

  return { url: page.url(), title };
}

export const snapshotSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  snapshot: z.string(),
});

export type ElementTarget = z.infer<typeof elementSchema>;

function locateElement(page: Page, element: ElementTarget): Locator {
  if ('ref' in element) {
    return page.getByRef(element.ref);
  }

  return page.getByRole(toAriaRole(element.role), { name: element.name, exact: true });
}

type AriaRole = Parameters<Page['getByRole']>[0];

const ariaRoleSchema = z.custom<AriaRole>((value) => typeof value === 'string');

function toAriaRole(role: string): AriaRole {
  return ariaRoleSchema.parse(role);
}
