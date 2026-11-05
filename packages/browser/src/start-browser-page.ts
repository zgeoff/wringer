import { WringerError } from '@wringer/core';
import type { ServiceInstance } from '@wringer/core';
import type { Browser, Locator, Page } from 'playwright-core';
import { createActor } from 'xstate';
import { z } from 'zod';
import { browserPageMachine } from './browser-page-machine.ts';
import type { PageActionResult } from './browser-page-machine.ts';
import { findSnapshotElement } from './find-snapshot-element.ts';
import { pickReopenURL } from './pick-reopen-url.ts';

export interface BrowserPageOptions {
  readonly launchBrowser: () => Promise<Browser>;
  readonly actionTimeoutMs: number;
  readonly reportError: (message: string) => void;
}

const refSchema = z.strictObject({ ref: z.string().min(1) });
const roleSchema = z.strictObject({ role: z.string().min(1), name: z.string() });
const elementSchema = z.union([refSchema, roleSchema]);
const gotoSchema = z.strictObject({ url: z.url({ protocol: /^https?$/v }) });
const typeSchema = z.strictObject({ element: elementSchema, value: z.string() });

// One headless browser and one page per run, held by the run's supervisor so the page keeps its
// state between commands. `describe` reads the last snapshot, because a new snapshot renumbers
// every ref, so it skips the command queue.
export async function startBrowserPage(options: BrowserPageOptions): Promise<ServiceInstance> {
  const browser = await options.launchBrowser();
  const runPage = await openRunPage(browser, options.actionTimeoutMs);

  const pageActor = createActor(browserPageMachine, {
    input: {
      page: runPage.firstPage,
      reopen: (stale: Page) => reopenPage(stale, runPage.openPage, options.reportError),
    },
  });

  pageActor.start();

  const runPageAction = (
    signal: AbortSignal,
    action: (page: Page) => Promise<PageActionResult>,
  ): Promise<unknown> => {
    const settle = Promise.withResolvers<unknown>();

    pageActor.send({ type: 'run', command: { action, signal, settle } });

    return settle.promise;
  };

  return {
    methods: {
      goto: (args, signal) =>
        runPageAction(signal, async (page) => {
          const parsed = gotoSchema.parse(args);

          await page.goto(parsed.url);

          return { data: await readPageState(page) };
        }),
      snapshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          const snapshot = await page.ariaSnapshot({ mode: 'ai' });
          const state = await readPageState(page);

          return { data: { ...state, snapshot }, snapshot };
        }),
      describe: (args) => {
        const parsed = refSchema.parse(args);
        const lastSnapshot = pageActor.getSnapshot().context.snapshot;
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

          return { data: await readPageState(page) };
        }),
      type: (args, signal) =>
        runPageAction(signal, async (page) => {
          const parsed = typeSchema.parse(args);

          await locateElement(page, parsed.element).fill(parsed.value);

          return { data: await readPageState(page) };
        }),
      screenshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          const png = await page.screenshot({ fullPage: true });

          return { data: { png: png.toString('base64') } };
        }),
      status: () => Promise.resolve({ connected: browser.isConnected() }),
    },
    stop: async () => {
      pageActor.send({ type: 'stop' });

      await browser.close();
    },
  };
}

interface RunPage {
  readonly firstPage: Page;
  readonly openPage: () => Promise<Page>;
}

// The supervisor holds no stop for this service until startup returns, so a failed setup closes
// the browser here, or Chromium outlives the run.
async function openRunPage(browser: Browser, actionTimeoutMs: number): Promise<RunPage> {
  try {
    // `browser.newPage` gives each page a context of its own, which dies with the page; one
    // context per run keeps the cookies and storage of a page that a timeout replaced.
    const context = await browser.newContext();

    const openPage = async (): Promise<Page> => {
      const opened = await context.newPage();

      opened.setDefaultTimeout(actionTimeoutMs);

      return opened;
    };

    return { firstPage: await openPage(), openPage };
  } catch (error) {
    await browser.close();

    throw error;
  }
}

async function reopenPage(
  stale: Page,
  openPage: () => Promise<Page>,
  reportError: (message: string) => void,
): Promise<Page> {
  const url = pickReopenURL(stale.url());

  // The stale page closes first, so its action cannot land while the new page opens.
  await stale.close();

  const page = await openPage();

  // A reload that fails leaves the new page blank, and the next `goto` recovers it; the page
  // itself must still come back, or every later command would fail.
  if (url !== null) {
    await page.goto(url).catch((error: unknown) => {
      reportError(`The replacement page could not reload ${url}: ${String(error)}`);
    });
  }

  return page;
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
