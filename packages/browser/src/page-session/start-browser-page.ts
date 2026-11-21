import { WringerError } from '@wringer/core';
import type { ServiceInstance } from '@wringer/core';
import type { Browser, Page } from 'playwright-core';
import { createActor } from 'xstate';
import { findSnapshotElement } from '../find-snapshot-element.ts';
import { createBrowserPageMachine } from './create-browser-page-machine.ts';
import type { PageActionResult } from './create-browser-page-machine.ts';
import { createTabSet } from './create-tab-set.ts';
import type { TabSet } from './create-tab-set.ts';
import { locateElement, refuseUnlistedOrigin, waitForEnabledControl } from './locate-element.ts';
import { pickReopenURL } from './pick-reopen-url.ts';
import { readPageState } from './read-page-state.ts';
import { registerTextEngine } from './register-text-engine.ts';
import { runTracked } from './run-tracked.ts';
import { FORCED_ACTION_TIMEOUT_MS, setChecked } from './set-checked.ts';
import { toPageServiceMethods } from './to-page-service-methods.ts';

export interface BrowserPageOptions {
  readonly launchBrowser: () => Promise<Browser>;
  readonly actionTimeoutMs: number;
  readonly reportError: (message: string) => void;
}

interface TypedPageActionResult<Data> extends PageActionResult {
  readonly data: Data;
}

// One headless browser per run, held by the run's supervisor so its tabs keep their state between
// commands. `describe` reads the last snapshot, because a new snapshot renumbers every ref, so it
// skips the command queue.
export async function startBrowserPage(options: BrowserPageOptions): Promise<ServiceInstance> {
  const browser = await options.launchBrowser();
  const tabs = await openRunTabs(browser, options.actionTimeoutMs);

  const pageActor = createActor(createBrowserPageMachine<TabSet>(), {
    input: {
      page: tabs,
      closePage: (stale: TabSet) => stale.closeActive(),
      reopen: (stale: TabSet) => reopenTab(stale, options.reportError),
    },
  });

  pageActor.start();

  // The machine's queue holds actions of every result type, so the typed result comes back
  // through the action's own closure once the machine settles the command.
  const runPageAction = async <Data>(
    signal: AbortSignal,
    action: (tabSet: TabSet, markLanded: () => void) => Promise<TypedPageActionResult<Data>>,
  ): Promise<Data> => {
    const settle = Promise.withResolvers<unknown>();
    const typed = Promise.withResolvers<Data>();
    let landed = false;

    const command = {
      action: async (tabSet: TabSet) => {
        const result = await action(tabSet, () => {
          landed = true;
        });

        typed.resolve(result.data);

        return result;
      },
      hasLanded: () => landed,
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
        runPageAction(signal, async (tabSet) => {
          const page = tabSet.getActive();

          await page.goto(args.url);

          return { data: await readPageState(page) };
        }),
      snapshot: (_args, signal) =>
        runPageAction(signal, async (tabSet) => {
          const page = requireOpenPage(tabSet);

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
        runPageAction(signal, (tabSet, markLanded) =>
          runTracked(tabSet, markLanded, async (page) => {
            const locator = await locateElement(page, args);

            if (args.origins === undefined) {
              await locator.click();

              return;
            }

            // Every wait of the click runs in the trial, so nothing waits between the origin check
            // and the forced click.
            await locator.click({ trial: true });

            refuseUnlistedOrigin(page, args.origins);

            await locator.click({ force: true, timeout: FORCED_ACTION_TIMEOUT_MS });
          }),
        ),
      type: (args, signal) =>
        runPageAction(signal, async (tabSet, markLanded) => {
          const page = tabSet.getActive();

          const locator = await locateElement(page, args.element);

          if (args.element.origins === undefined) {
            await locator.fill(args.value);
          } else {
            await waitForEnabledControl(page, locator, 'visible');

            refuseUnlistedOrigin(page, args.element.origins);

            await locator.fill(args.value, { force: true, timeout: FORCED_ACTION_TIMEOUT_MS });
          }

          markLanded();

          return { data: await readPageState(page) };
        }),
      check: (args, signal) =>
        runPageAction(signal, async (tabSet, markLanded) => ({
          data: await setChecked(tabSet.getActive(), args, true, markLanded),
        })),
      uncheck: (args, signal) =>
        runPageAction(signal, async (tabSet, markLanded) => ({
          data: await setChecked(tabSet.getActive(), args, false, markLanded),
        })),
      press: (args, signal) =>
        runPageAction(signal, (tabSet, markLanded) =>
          runTracked(tabSet, markLanded, async (page) => {
            if (args.element === undefined) {
              await page.keyboard.press(args.key);

              return;
            }

            const locator = await locateElement(page, args.element, 'attached');

            if (args.element.origins === undefined) {
              await locator.press(args.key);

              return;
            }

            await waitForEnabledControl(page, locator, 'attached');

            refuseUnlistedOrigin(page, args.element.origins);

            await locator.press(args.key, { timeout: FORCED_ACTION_TIMEOUT_MS });
          }),
        ),
      hover: (args, signal) =>
        runPageAction(signal, async (tabSet) => {
          const page = tabSet.getActive();

          const locator = await locateElement(page, args);

          await locator.hover();

          return { data: await readPageState(page) };
        }),
      screenshot: (_args, signal) =>
        runPageAction(signal, async (tabSet) => {
          const png = await requireOpenPage(tabSet).screenshot({ fullPage: true });

          return { data: { png: png.toString('base64') } };
        }),
      tabs: (_args, signal) =>
        runPageAction(signal, async (tabSet) => {
          const active = tabSet.getActive();

          const listed = await Promise.all(
            tabSet.list().map(async (page, index) => ({
              index,
              url: page.url(),
              title: await page.title(),
              active: page === active,
            })),
          );

          return { data: { tabs: listed } };
        }),
      tab: (args, signal) =>
        runPageAction(signal, async (tabSet) => {
          const page = tabSet.list()[args.index];

          if (page === undefined) {
            throw new WringerError('usage', {
              message: `There is no tab ${args.index}.`,
              hint: 'Run `browser tabs` to list the open tabs.',
            });
          }

          await tabSet.activate(page);

          return { data: await readPageState(page), snapshot: '' };
        }),
      closeTab: (_args, signal) =>
        runPageAction(signal, (tabSet, markLanded) => {
          if (tabSet.list().length < 2) {
            throw new WringerError('usage', {
              message: 'The browser has one tab, and it cannot close its last tab.',
              hint: 'Run `browser tabs` to list the open tabs.',
            });
          }

          return runTracked(tabSet, markLanded, async (page) => {
            await page.close();
          });
        }),
      activeURL: () => Promise.resolve({ url: tabs.getActive().url() }),
      status: () => Promise.resolve({ connected: browser.isConnected() }),
    }),
    stop: async () => {
      pageActor.send({ type: 'stop' });

      await browser.close();
    },
  };
}

// The supervisor holds no stop for this service until startup returns, so a failed setup closes
// the browser here, or Chromium outlives the run.
async function openRunTabs(browser: Browser, actionTimeoutMs: number): Promise<TabSet> {
  try {
    // `browser.newPage` gives each page a context of its own, which dies with the page; one
    // context per run keeps the cookies and storage of a page that a timeout replaced, and lets
    // a tab that a page opens share them.
    await registerTextEngine();

    const context = await browser.newContext();

    return await createTabSet(context, actionTimeoutMs);
  } catch (error) {
    await browser.close();

    throw error;
  }
}

async function reopenTab(stale: TabSet, reportError: (message: string) => void): Promise<TabSet> {
  const url = pickReopenURL(stale.getReplacedURL());

  const page = await stale.open();

  stale.replaceActive(page);

  // A reload that fails leaves the new page blank, and the next `goto` recovers it; the page
  // itself must still come back, or every later command would fail.
  if (url !== null) {
    await page.goto(url).catch((error: unknown) => {
      reportError(`The replacement page could not reload ${url}: ${String(error)}`);
    });
  }

  return stale;
}

// A page with no goto behind it shows nothing, so a snapshot or a screenshot of it is a mistake of
// the caller, not evidence.
function requireOpenPage(tabSet: TabSet): Page {
  const page = tabSet.getActive();

  if (page.url() === 'about:blank') {
    throw new WringerError('usage', {
      message: 'The page is blank, because no `browser goto` has opened a page yet.',
      hint: 'Run `browser goto /` first.',
    });
  }

  return page;
}
