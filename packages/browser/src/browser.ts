import { setTimeout as sleep } from 'node:timers/promises';
import { WringerError, defineDriver, evidenceSchema } from '@wringer/core';
import type { DriverSession, Evidence, Fence } from '@wringer/core';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { buildAppURL } from './build-app-url.ts';
import { callPage } from './call-page.ts';
import { makeChromiumLauncher } from './chromium-launch/make-chromium-launcher.ts';
import { collectEndpointURLs } from './endpoints/collect-endpoint-urls.ts';
import { readEndpointFailure } from './endpoints/read-endpoint-failure.ts';
import type { SnapshotElement } from './find-snapshot-element.ts';
import { isListedOrigin } from './is-listed-origin.ts';
import { findLocatorProblem } from './locators/find-locator-problem.ts';
import type { LocatorArgs } from './locators/find-locator-problem.ts';
import { pickCommandEffect } from './locators/pick-command-effect.ts';
import {
  actionStateSchema,
  checkStateSchema,
  pageStateSchema,
  snapshotSchema,
  tabsSchema,
} from './page-service-contract.ts';
import type { ElementTarget, PageArgs } from './page-service-contract.ts';
import { startBrowserPage } from './page-session/start-browser-page.ts';
import { pickActionEffect } from './pick-browser-effect.ts';
import { readSnapshot } from './snapshot-wait/read-snapshot.ts';

export type PageState = z.infer<typeof pageStateSchema>;

export type PageSnapshot = z.infer<typeof snapshotSchema>;

export interface DescribedElement extends SnapshotElement {
  readonly ref: string;
}

export type ActionState = z.infer<typeof actionStateSchema>;

export type CheckState = z.infer<typeof checkStateSchema>;

export type TabList = z.infer<typeof tabsSchema>;

export interface GotoRequest {
  readonly path: string;

  // The name of another endpoint of the run that the target config lists.
  readonly endpoint?: string | undefined;
}

export interface TabRequest {
  readonly index: number;
}

export interface PressRequest {
  readonly key: string;

  // Without an element, the key goes to the focused element.
  readonly element?: ElementTarget | undefined;
}

export interface DescribeRequest {
  readonly ref: string;
}

export type TypeRequest = ElementTarget & { readonly value: string };

export interface SnapshotRequest {
  // Wait for a snapshot that holds this text.
  readonly untilText?: string | undefined;

  // Wait for a snapshot that lacks this text.
  readonly untilNoText?: string | undefined;
}

export interface BrowserClient {
  readonly goto: (request: GotoRequest) => Promise<PageState>;
  readonly snapshot: (request?: SnapshotRequest) => Promise<PageSnapshot>;
  readonly describe: (request: DescribeRequest) => Promise<DescribedElement>;
  readonly click: (element: ElementTarget) => Promise<ActionState>;
  readonly type: (request: TypeRequest) => Promise<PageState>;
  readonly check: (element: ElementTarget) => Promise<CheckState>;
  readonly uncheck: (element: ElementTarget) => Promise<CheckState>;
  readonly press: (request: PressRequest) => Promise<ActionState>;
  readonly hover: (element: ElementTarget) => Promise<PageState>;
  readonly tabs: () => Promise<TabList>;
  readonly tab: (request: TabRequest) => Promise<PageState>;
  readonly closeTab: () => Promise<ActionState>;
  readonly screenshot: () => Promise<Evidence>;
}

const optionsSchema = z.strictObject({
  executablePath: z.string().min(1).optional(),
  actionTimeoutMs: z.number().int().positive().default(10_000),
});

const grantSchema = z.strictObject({ role: z.string().min(1), name: z.string() });

const targetConfigSchema = z.strictObject({
  endpoint: z.string().min(1).default('web'),
  baseURL: z.url().optional(),
  endpoints: z.array(z.string().min(1)).default([]),
  readOnly: z.strictObject({ allow: z.array(grantSchema) }).optional(),
});

const locatorShape = {
  ref: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  name: z.string().optional(),
  label: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
};

const elementArgsSchema = z.strictObject(locatorShape).superRefine((args, ctx) => {
  addLocatorIssue(args, true, ctx);
});

const typeArgsSchema = z
  .strictObject({ ...locatorShape, value: z.string() })
  .superRefine((args, ctx) => {
    addLocatorIssue(args, true, ctx);
  });

const pressArgsSchema = z
  .strictObject({ ...locatorShape, key: z.string().min(1) })
  .superRefine((args, ctx) => {
    addLocatorIssue(args, false, ctx);
  });

const gotoArgsSchema = z.strictObject({
  path: z.string().startsWith('/'),
  endpoint: z.string().min(1).optional(),
});

const snapshotArgsSchema = z.strictObject({
  untilText: z.string().min(1).optional(),
  untilNoText: z.string().min(1).optional(),
});

const tabArgsSchema = z.strictObject({
  target: z.string().regex(/^(?:close|\d+)$/u, { message: 'Pass a tab index, or `close`.' }),
});

interface PreparedAction {
  readonly described: SnapshotElement | null;
  readonly onAllowedOrigin: boolean;
}

// Drives one page of the target's app in a headless browser that the run's supervisor holds.
// Going to a page, reading it and taking a screenshot are reads. A click or typing is a write,
// which a read-only target refuses unless its `readOnly.allow` grants the element's role and name.
export const browser = defineDriver({
  name: 'browser',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  services: {
    page: {
      start: (ctx) =>
        startBrowserPage({
          launchBrowser: makeChromiumLauncher(
            (options) => chromium.launch(options),
            ctx.options.executablePath,
          ),
          actionTimeoutMs: ctx.options.actionTimeoutMs,

          // The supervisor holds the page, and its stderr goes to the supervisor's log.
          reportError: (message) => {
            process.stderr.write(`${message}\n`);
          },
        }),
    },
  },
  client: (session, fence): BrowserClient => {
    const page = session.service('page');

    const describe = fence({
      effect: () => 'read',
      describe: (request: DescribeRequest) => `browser describe ${request.ref}`,
      run: (request) => callPage(page, 'describe', request),
    });

    const describeTarget = (element: ElementTarget): Promise<SnapshotElement> => {
      if ('ref' in element) {
        return describe({ ref: element.ref });
      }

      // A label names the control and not its accessible name, but a grant for it names both.
      if ('label' in element) {
        return Promise.resolve({ role: element.role ?? '', name: element.label });
      }

      // Shown text can hold more than the name, so only a role with the text can match a grant,
      // and the page then also requires the name to be the text.
      if ('text' in element) {
        return Promise.resolve({ role: element.role ?? '', name: element.text });
      }

      return Promise.resolve(element);
    };

    const acts = makeElementActions(session, fence);

    const snapshot = fence({
      effect: () => 'read',
      describe: () => 'browser snapshot',
      run: (request: SnapshotRequest) =>
        readSnapshot(request, {
          takeSnapshot: () => callPage(page, 'snapshot', null),
          wait: (delayMs, signal) => sleep(delayMs, undefined, { signal }),
          timeLeftMs: session.timeLeftMs,
          actionTimeoutMs: session.options.actionTimeoutMs,
          writeSnapshot: async (text) => {
            await session.evidence.writeFile('browser', 'snapshot.yaml', text);
          },
        }),
    });

    const screenshot = fence({
      effect: () => 'read',
      describe: () => 'browser screenshot',
      run: async (request: null) => {
        const parsed = await callPage(page, 'screenshot', request);

        return session.evidence.writeFile(
          'screenshot',
          'page.png',
          Buffer.from(parsed.png, 'base64'),
        );
      },
    });

    const hover = fence({
      effect: () => 'read',
      describe: (element: ElementTarget) => `browser hover ${JSON.stringify(element)}`,
      run: (element) => callPage(page, 'hover', element),
    });

    const tabs = fence({
      effect: () => 'read',
      describe: () => 'browser tabs',
      run: (request: null) => callPage(page, 'tabs', request),
    });

    const tab = fence({
      effect: () => 'read',
      describe: (request: TabRequest) => `browser tab ${request.index}`,
      run: (request) => callPage(page, 'tab', request),
    });

    const closeTab = fence({
      effect: () => 'read',
      describe: () => 'browser tab close',
      run: (request: null) => callPage(page, 'closeTab', request),
    });

    // The fence decides before the call runs, so the client reads the element and the tab the call
    // will act on.
    const prepare = async (element: ElementTarget | undefined): Promise<PreparedAction> => {
      const described = element === undefined ? null : await describeTarget(element);

      const active = await callPage(page, 'activeURL', null);

      return { described, onAllowedOrigin: isAllowedOrigin(session, active.url) };
    };

    return {
      goto: fence({
        effect: () => 'read',
        describe: (request: GotoRequest) => `browser goto ${request.path}`,
        run: async (request) => {
          const url = buildAppURL(request.path, getEndpointURL(session, request.endpoint));

          if (url instanceof WringerError) {
            throw url;
          }

          const state = await callPage(page, 'goto', { url });

          return state;
        },
      }),
      snapshot: (request = {}) => snapshot(request),
      describe,
      click: async (element) =>
        acts.click({ ...(await prepare(element)), args: guardElement(session, element) }),
      type: async (request) => {
        const element = pickElementTarget(request);

        return acts.type({
          ...(await prepare(element)),
          args: { element: guardElement(session, element), value: request.value },
        });
      },
      check: async (element) =>
        acts.check({ ...(await prepare(element)), args: guardElement(session, element) }),
      uncheck: async (element) =>
        acts.uncheck({ ...(await prepare(element)), args: guardElement(session, element) }),
      press: async (request) =>
        acts.press({
          ...(await prepare(request.element)),
          args: {
            key: request.key,
            element:
              request.element === undefined ? undefined : guardElement(session, request.element),
          },
        }),

      // A ref the last snapshot does not hold fails here, as it does for every other action, because
      // a tab switch clears the snapshot while the browser still resolves the ref.
      hover: async (element) => {
        await describeTarget(element);

        return hover(element);
      },
      tabs: () => tabs(null),
      tab,
      closeTab: () => closeTab(null),
      screenshot: () => screenshot(null),
    };
  },
  commands: (command) => [
    command({
      path: ['browser', 'goto'],
      summary:
        'Open a path of the target app in the browser, on --endpoint when the config lists one',
      args: gotoArgsSchema,
      positionals: ['path'],
      data: pageStateSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.goto(args),
    }),
    command({
      path: ['browser', 'snapshot'],
      summary:
        'Print the page as an accessibility tree, with a ref for each element, after --until-text shows or --until-no-text goes',
      args: snapshotArgsSchema,
      data: snapshotSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.snapshot(args),
    }),
    command({
      path: ['browser', 'click'],
      summary:
        'Click an element, by --ref from the last snapshot, by --role and --name, by --label, or by --text it shows',
      args: elementArgsSchema,
      data: actionStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config.readOnly?.allow ?? []),
      run: (args, ctx) => ctx.client.click(pickElementTarget(args)),
    }),
    command({
      path: ['browser', 'type'],
      summary:
        'Type --value into a field, by --ref from the last snapshot, by --role and --name, by --label, or by --text it shows',
      args: typeArgsSchema,
      data: pageStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config.readOnly?.allow ?? []),
      run: (args, ctx) => ctx.client.type({ ...pickElementTarget(args), value: args.value }),
    }),
    command({
      path: ['browser', 'check'],
      summary: 'Tick a checkbox or a radio button, found like a click finds an element',
      args: elementArgsSchema,
      data: checkStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config.readOnly?.allow ?? []),
      run: (args, ctx) => ctx.client.check(pickElementTarget(args)),
    }),
    command({
      path: ['browser', 'uncheck'],
      summary: 'Untick a checkbox, found like a click finds an element',
      args: elementArgsSchema,
      data: checkStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config.readOnly?.allow ?? []),
      run: (args, ctx) => ctx.client.uncheck(pickElementTarget(args)),
    }),
    command({
      path: ['browser', 'press'],
      summary:
        'Press a key, such as Enter or Control+A, on an element, or on the focused element with no locator flag',
      args: pressArgsSchema,
      positionals: ['key'],
      data: actionStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config.readOnly?.allow ?? []),
      run: (args, ctx) =>
        ctx.client.press({ key: args.key, element: pickOptionalElementTarget(args) }),
    }),
    command({
      path: ['browser', 'hover'],
      summary: 'Move the pointer over an element, found like a click finds an element',
      args: elementArgsSchema,
      data: pageStateSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.hover(pickElementTarget(args)),
    }),
    command({
      path: ['browser', 'tabs'],
      summary: 'List the open tabs, with the active one marked',
      args: z.strictObject({}),
      data: tabsSchema,
      effect: 'read',
      run: (_args, ctx) => ctx.client.tabs(),
    }),
    command({
      path: ['browser', 'tab'],
      summary:
        'Switch to the tab with an index from `browser tabs`, or close the active tab with `close`',
      args: tabArgsSchema,
      positionals: ['target'],
      data: actionStateSchema,
      effect: 'read',
      run: (args, ctx) =>
        args.target === 'close'
          ? ctx.client.closeTab()
          : ctx.client.tab({ index: Number(args.target) }),
    }),
    command({
      path: ['browser', 'screenshot'],
      summary: 'Keep a screenshot of the page as evidence',
      args: z.strictObject({}),
      data: evidenceSchema,
      effect: 'read',
      run: (_args, ctx) => ctx.client.screenshot(),
    }),
  ],
  checks: [
    {
      name: 'launched',
      timeoutMs: 5000,
      run: async (ctx) => {
        const status = await callPage(ctx.session.service('page'), 'status', null);

        if (!status.connected) {
          throw new WringerError('check-failed', { message: 'The browser has closed.' });
        }
      },
    },
    {
      name: 'reachable',
      timeoutMs: 10_000,
      run: async (ctx) => {
        for (const endpoint of collectEndpointURLs(ctx.session.config, ctx.session.endpoints)) {
          // A name with no URL is a config mistake that `goto` reports as a usage error.
          if (endpoint.url === undefined) {
            continue;
          }

          const failure = await readEndpointFailure(endpoint.url, ctx.session.signal);

          if (failure !== null) {
            throw new WringerError('check-failed', {
              message: `Endpoint ${endpoint.name} at ${endpoint.url} is not reachable. ${failure}`,
            });
          }
        }
      },
    },
  ],
});

type BrowserOptions = z.infer<typeof optionsSchema>;

type BrowserConfig = z.infer<typeof targetConfigSchema>;

type BrowserSession = DriverSession<BrowserOptions, BrowserConfig>;

type ActedMethod = 'click' | 'type' | 'check' | 'uncheck' | 'press';

type ActionRequest<Method extends ActedMethod> = PreparedAction & {
  readonly args: PageArgs<Method>;
};

// The fence decides on the element's role and name and on the tab's origin, so the client reads
// both before the call.
function makeElementActions(session: BrowserSession, fence: Fence) {
  const makeAction = <Method extends ActedMethod>(method: Method) =>
    fence({
      effect: (action: ActionRequest<Method>) =>
        pickActionEffect(
          { element: action.described, onAllowedOrigin: action.onAllowedOrigin },
          session.config.readOnly?.allow ?? [],
        ),
      describe: (action) =>
        action.described === null
          ? `${method} on the focused element`
          : `${method} on ${action.described.role} "${action.described.name}"`,
      run: (action) => callPage(session.service('page'), method, action.args),
    });

  return {
    click: makeAction('click'),
    type: makeAction('type'),
    check: makeAction('check'),
    uncheck: makeAction('uncheck'),
    press: makeAction('press'),
  };
}

// A write grant holds only on the origins of the endpoints the driver may visit: a tab that landed
// elsewhere shows controls that no grant was written for.
function isAllowedOrigin(session: BrowserSession, tabURL: string): boolean {
  return isListedOrigin(tabURL, collectAllowedOrigins(session));
}

function collectAllowedOrigins(session: BrowserSession): string[] {
  return collectEndpointURLs(session.config, session.endpoints).flatMap((endpoint) => {
    const origin = endpoint.url === undefined ? undefined : URL.parse(endpoint.url)?.origin;

    return origin === undefined ? [] : [origin];
  });
}

function getEndpointURL(session: BrowserSession, endpoint: string | undefined): string {
  const name = endpoint ?? session.config.endpoint;
  const allowed = collectEndpointURLs(session.config, session.endpoints);
  const found = allowed.find((candidate) => candidate.name === name);

  if (found === undefined) {
    throw new WringerError('usage', {
      message: `The browser config of target ${session.target} does not list the endpoint ${name}.`,
      hint: `Name one of ${allowed.map((candidate) => candidate.name).join(', ')}, or list the endpoint in the \`endpoints\` of the browser config.`,
    });
  }

  if (found.url === undefined) {
    throw new WringerError('usage', {
      message: `Target ${session.target} has no endpoint ${name}.`,
      hint: 'Set `baseURL` in the browser config of the target, or name an endpoint it has.',
    });
  }

  return found.url;
}

// A read-only target's write is granted for the app's origins only, and the page checks the tab's
// origin again when the element is ready, which the tab can leave while the action waits.
function guardElement(session: BrowserSession, element: ElementTarget): ElementTarget {
  return session.config.readOnly === undefined
    ? element
    : { ...element, origins: collectAllowedOrigins(session) };
}

type ElementArgs = LocatorArgs;

function pickElementTarget(args: ElementArgs): ElementTarget {
  if (args.ref !== undefined) {
    return { ref: args.ref };
  }

  if (args.text !== undefined) {
    return args.role === undefined ? { text: args.text } : { text: args.text, role: args.role };
  }

  if (args.label !== undefined) {
    return args.role === undefined ? { label: args.label } : { label: args.label, role: args.role };
  }

  return { role: args.role ?? '', name: args.name ?? '' };
}

function addLocatorIssue(args: LocatorArgs, required: boolean, ctx: z.RefinementCtx): void {
  const problem = findLocatorProblem(args, required);

  if (problem !== null) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
}

function pickOptionalElementTarget(args: ElementArgs): ElementTarget | undefined {
  const hasLocator = [args.ref, args.role, args.label, args.text].some(
    (flag) => flag !== undefined,
  );

  return hasLocator ? pickElementTarget(args) : undefined;
}
