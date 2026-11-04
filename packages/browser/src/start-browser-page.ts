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

  const page = await browser.newPage();

  page.setDefaultTimeout(options.actionTimeoutMs);

  let lastSnapshot = '';

  return {
    methods: {
      goto: (args) =>
        runPageAction(async () => {
          const parsed = gotoSchema.parse(args);

          await page.goto(parsed.url);

          return readPageState(page);
        }),
      snapshot: () =>
        runPageAction(async () => {
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
      click: (args) =>
        runPageAction(async () => {
          await locateElement(page, elementSchema.parse(args)).click();

          return readPageState(page);
        }),
      type: (args) =>
        runPageAction(async () => {
          const parsed = typeSchema.parse(args);

          await locateElement(page, parsed.element).fill(parsed.value);

          return readPageState(page);
        }),
      screenshot: () =>
        runPageAction(async () => {
          const png = await page.screenshot({ fullPage: true });

          return { png: png.toString('base64') };
        }),
      status: () => Promise.resolve({ connected: browser.isConnected() }),
    },
    stop: () => browser.close(),
  };
}

// Playwright reports a missing element as a timeout and anything else as a plain error; both reach
// the caller as one of the envelope's error codes.
async function runPageAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw toPageError(error);
  }
}

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
