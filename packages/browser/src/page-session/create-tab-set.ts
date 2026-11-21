import type { BrowserContext, Download, Page } from 'playwright-core';
import type { DownloadInfo } from './types.ts';

// A wait for the next download of any tab. Cancel it when something else ended the wait.
interface DownloadWait {
  readonly done: Promise<DownloadInfo>;
  readonly cancel: () => void;
}

// The tabs of the run's one browser context, in the order they opened, and the one the driver acts
// on. A tab that closes by itself stays in the list until the next read, so a caller can find the
// index it held.
export interface TabSet {
  // The tabs that are still open.
  readonly list: () => readonly Page[];
  readonly getActive: () => Page;
  readonly getOpener: (page: Page) => Page | null;
  readonly activate: (page: Page) => Promise<void>;
  readonly open: () => Promise<Page>;

  // Closes the active tab to replace it: the new tab takes its place, index and opener.
  readonly closeActive: () => Promise<void>;
  readonly replaceActive: (fresh: Page) => void;
  readonly getReplacedURL: () => string;

  // The downloads that tabs have started, in order. The driver keeps no file: it cancels and removes
  // each one, since evidence is uploaded.
  readonly listDownloads: () => readonly DownloadInfo[];

  // Resolves with the first download after the first `seen` ones.
  readonly waitForDownload: (seen: number) => DownloadWait;

  // True for a tab that the driver closed to replace it, as against one that closed by itself.
  readonly wasReplaced: (page: Page) => boolean;
}

export async function createTabSet(
  context: BrowserContext,
  actionTimeoutMs: number,
): Promise<TabSet> {
  let pages: Page[] = [];
  let active: Page | null = null;
  let replacing: Page | null = null;
  let replacedURL = '';
  const downloads: DownloadInfo[] = [];

  const downloadWaiters = new Set<{ seen: number; resolve: (info: DownloadInfo) => void }>();
  const openers = new WeakMap<Page, Page>();
  const replaced = new WeakSet<Page>();

  // Chromium reports a download on the page that started it, before the page event of a tab that
  // the download opened.
  const recordDownload = (download: Download): void => {
    const info = { url: download.url(), fileName: download.suggestedFilename() };

    downloads.push(info);

    for (const waiter of downloadWaiters) {
      if (downloads.length > waiter.seen) {
        waiter.resolve(info);
        downloadWaiters.delete(waiter);
      }
    }

    void discardDownload(download);
  };

  const register = (page: Page): void => {
    if (!pages.includes(page)) {
      page.setDefaultTimeout(actionTimeoutMs);
      pages.push(page);
      page.on('download', recordDownload);
      void recordOpener(page, openers);
    }
  };

  context.on('page', register);

  const list = (): readonly Page[] => {
    pages = pages.filter((page) => !page.isClosed() || page === replacing);

    return pages.filter((page) => !page.isClosed());
  };

  const open = async (): Promise<Page> => {
    const opened = await context.newPage();

    register(opened);

    return opened;
  };

  const first = await open();

  active = first;

  const getActive = (): Page => {
    if (active !== null && !active.isClosed()) {
      return active;
    }

    const [remaining] = list();

    active = remaining ?? active ?? first;

    return active;
  };

  return {
    list,
    getActive,
    getOpener: (page) => openers.get(page) ?? null,
    activate: async (page) => {
      active = page;

      await page.bringToFront();
    },
    open,
    closeActive: async () => {
      const stale = getActive();

      replacing = stale;

      replaced.add(stale);

      replacedURL = stale.url();

      await stale.close();
    },
    replaceActive: (fresh) => {
      const staleIndex = replacing === null ? -1 : pages.indexOf(replacing);

      if (replacing !== null && staleIndex !== -1) {
        pages = pages.filter((page) => page !== fresh);

        const opener = openers.get(replacing);

        pages.splice(staleIndex, 1, fresh);

        if (opener !== undefined) {
          openers.set(fresh, opener);
        }
      }

      replacing = null;
      active = fresh;
    },
    getReplacedURL: () => replacedURL,
    wasReplaced: (page) => replaced.has(page),
    listDownloads: () => downloads,
    waitForDownload: (seen) => {
      const pending = Promise.withResolvers<DownloadInfo>();
      const waiter = { seen, resolve: pending.resolve };
      const arrived = downloads[seen];

      if (arrived === undefined) {
        downloadWaiters.add(waiter);
      } else {
        pending.resolve(arrived);
      }

      return {
        done: pending.promise,
        cancel: () => {
          downloadWaiters.delete(waiter);
        },
      };
    },
  };
}

async function discardDownload(download: Download): Promise<void> {
  try {
    await download.cancel();
    await download.delete();
  } catch {
    // A download that is already gone needs no removal.
  }
}

// A popup's opener is known once the popup exists. A page that closed first has none to record.
async function recordOpener(page: Page, openers: WeakMap<Page, Page>): Promise<void> {
  try {
    const opener = await page.opener();

    if (opener !== null) {
      openers.set(page, opener);
    }
  } catch {
    // A page with no known opener goes back to a neighbour when it closes.
  }
}
