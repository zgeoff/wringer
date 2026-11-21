import { WringerError } from '@wringer/core';
import type { Page } from 'playwright-core';
import type { PageResult } from '../page-service-contract.ts';
import type { PageActionResult } from './create-browser-page-machine.ts';
import type { TabSet } from './create-tab-set.ts';
import { pickReturnTab } from './pick-return-tab.ts';
import { readPageState } from './read-page-state.ts';
import type { DownloadInfo } from './types.ts';
import { waitQuietly } from './wait-quietly.ts';

// Acts on the active tab, then reports the tab the action opened, or the tab it closed. The browser
// reports a new tab after the click that opened it, so a round trip to every tab comes first.
export async function runTracked(
  tabSet: TabSet,
  markLanded: () => void,
  act: (page: Page) => Promise<void>,
): Promise<PageActionResult & { readonly data: PageResult<'click'> }> {
  const before = tabSet.list();
  const active = tabSet.getActive();
  const activeIndex = before.indexOf(active);
  const downloadsBefore = tabSet.listDownloads().length;

  try {
    await act(active);
  } catch (error) {
    if (tabSet.wasReplaced(active)) {
      throw error;
    }

    const closed = await probeClosed(active);

    if (!closed) {
      throw error;
    }
  }

  markLanded();

  await Promise.all(tabSet.list().map((page) => waitQuietly(page.evaluate('0'))));

  const data = await reconcileTabs(tabSet, { before, active, activeIndex, downloadsBefore });

  // A switch of tabs leaves the last snapshot's refs pointing at another page.
  return data.openedTab === undefined && data.closedTab === undefined
    ? { data }
    : { data, snapshot: '' };
}

// A click on a page that closes itself may fail before the close event arrives.
async function probeClosed(page: Page): Promise<boolean> {
  if (page.isClosed()) {
    return true;
  }

  try {
    await page.waitForEvent('close', { timeout: 500 });

    return true;
  } catch {
    return false;
  }
}

interface TabsBefore {
  readonly before: readonly Page[];
  readonly active: Page;
  readonly activeIndex: number;
  readonly downloadsBefore: number;
}

async function reconcileTabs(tabSet: TabSet, was: TabsBefore): Promise<PageResult<'click'>> {
  const download = await settleDownload(tabSet, was);

  const after = tabSet.list();
  const opened = after.findLast((page) => !was.before.includes(page));
  const wasClosed = was.active.isClosed();
  const downloaded = download === undefined ? {} : { download };

  if (opened !== undefined) {
    await waitQuietly(opened.waitForLoadState('domcontentloaded'));

    await tabSet.activate(opened);

    const state = await readPageState(opened);

    const openedTab = after.indexOf(opened);

    return wasClosed
      ? { ...state, closedTab: was.activeIndex, openedTab, ...downloaded }
      : { ...state, openedTab, ...downloaded };
  }

  if (!wasClosed) {
    return { ...(await readPageState(was.active)), ...downloaded };
  }

  const returnPage = await readReturnPage(tabSet, was, after);

  await tabSet.activate(returnPage);

  const state = await readPageState(returnPage);

  return { ...state, closedTab: was.activeIndex, ...downloaded };
}

// A download that opened a tab leaves it blank, and a blank tab never finishes loading, so the
// wait for its load ends with the download instead. The blank tab closes, and the driver stays on
// the page. A tab that has a URL stays open next to the download.
async function settleDownload(tabSet: TabSet, was: TabsBefore): Promise<DownloadInfo | undefined> {
  const opened = tabSet.list().findLast((page) => !was.before.includes(page));

  if (opened !== undefined) {
    const wait = tabSet.waitForDownload(was.downloadsBefore);

    try {
      await Promise.race([waitQuietly(opened.waitForLoadState('domcontentloaded')), wait.done]);
    } finally {
      wait.cancel();
    }
  }

  const download = tabSet.listDownloads()[was.downloadsBefore];

  if (download !== undefined && opened !== undefined && isBlankURL(opened.url())) {
    await waitQuietly(opened.close());
  }

  return download;
}

function isBlankURL(url: string): boolean {
  return url === '' || url === 'about:blank';
}

function readReturnPage(tabSet: TabSet, was: TabsBefore, after: readonly Page[]): Promise<Page> {
  const found = findReturnPage(tabSet, was, after);

  return found === null ? tabSet.open() : Promise.resolve(found);
}

function findReturnPage(tabSet: TabSet, was: TabsBefore, after: readonly Page[]): Page | null {
  const opener = tabSet.getOpener(was.active);
  const openerIndex = opener === null ? -1 : after.indexOf(opener);
  const knownOpenerIndex = openerIndex === -1 ? null : openerIndex;
  const returnIndex = pickReturnTab(knownOpenerIndex, was.activeIndex, after.length);

  if (returnIndex === null) {
    return null;
  }

  const returnPage = after[returnIndex];

  if (returnPage === undefined) {
    throw new WringerError('environment', { message: 'The browser lost track of its tabs.' });
  }

  return returnPage;
}
