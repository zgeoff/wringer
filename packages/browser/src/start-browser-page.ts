import { WringerError } from '@wringer/core';
import type { ServiceInstance } from '@wringer/core';
import type { Browser, Locator, Page } from 'playwright-core';
import { createActor } from 'xstate';
import { z } from 'zod';
import { createBrowserPageMachine } from './create-browser-page-machine.ts';
import type { PageActionResult } from './create-browser-page-machine.ts';
import { findSnapshotElement } from './find-snapshot-element.ts';
import type { ElementTarget, PageResult } from './page-service-contract.ts';
import { pickReopenURL } from './pick-reopen-url.ts';
import { toPageServiceMethods } from './to-page-service-methods.ts';

export interface BrowserPageOptions {
  readonly launchBrowser: () => Promise<Browser>;
  readonly actionTimeoutMs: number;
  readonly reportError: (message: string) => void;
}

interface TypedPageActionResult<Data> extends PageActionResult {
  readonly data: Data;
}

// One headless browser and one page per run, held by the run's supervisor so the page keeps its
// state between commands. `describe` reads the last snapshot, because a new snapshot renumbers
// every ref, so it skips the command queue.
export async function startBrowserPage(options: BrowserPageOptions): Promise<ServiceInstance> {
  const browser = await options.launchBrowser();
  const runPage = await openRunPage(browser, options.actionTimeoutMs);

  const pageActor = createActor(createBrowserPageMachine<Page>(), {
    input: {
      page: runPage.firstPage,
      closePage: (stale: Page) => stale.close(),
      reopen: (stale: Page) => reopenPage(stale, runPage.openPage, options.reportError),
    },
  });

  pageActor.start();

  // The machine's queue holds actions of every result type, so the typed result comes back
  // through the action's own closure once the machine settles the command.
  const runPageAction = async <Data>(
    signal: AbortSignal,
    action: (page: Page) => Promise<TypedPageActionResult<Data>>,
  ): Promise<Data> => {
    const settle = Promise.withResolvers<unknown>();
    const typed = Promise.withResolvers<Data>();

    const command = {
      action: async (page: Page) => {
        const result = await action(page);

        typed.resolve(result.data);

        return result;
      },
      signal,
      settle,
    };

    pageActor.send({ type: 'run', command });

    await settle.promise;

    return typed.promise;
  };

  return {
    methods: toPageServiceMethods({
      goto: (args, signal) =>
        runPageAction(signal, async (page) => {
          await page.goto(args.url);

          return { data: await readPageState(page) };
        }),
      snapshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          const snapshot = await page.ariaSnapshot({ mode: 'ai' });
          const state = await readPageState(page);

          return { data: { ...state, snapshot }, snapshot };
        }),
      describe: (args) => {
        const lastSnapshot = pageActor.getSnapshot().context.snapshot;
        const element = findSnapshotElement(lastSnapshot, args.ref);

        if (element === null) {
          return Promise.reject(
            new WringerError('usage', {
              message: `The last snapshot has no element ${args.ref}.`,
              hint: 'Run `browser snapshot`, then use a ref it printed.',
            }),
          );
        }

        return Promise.resolve({ ref: args.ref, ...element });
      },
      click: (args, signal) =>
        runPageAction(signal, async (page) => {
          await locateElement(page, args).click();

          return { data: await readPageState(page) };
        }),
      type: (args, signal) =>
        runPageAction(signal, async (page) => {
          await locateElement(page, args.element).fill(args.value);

          return { data: await readPageState(page) };
        }),
      screenshot: (_args, signal) =>
        runPageAction(signal, async (page) => {
          const png = await page.screenshot({ fullPage: true });

          return { data: { png: png.toString('base64') } };
        }),
      status: () => Promise.resolve({ connected: browser.isConnected() }),
    }),
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

async function readPageState(page: Page): Promise<PageResult<'goto'>> {
  const title = await page.title();

  return { url: page.url(), title };
}

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
