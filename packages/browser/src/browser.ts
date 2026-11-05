import { WringerError, defineDriver, findOwnValue } from '@wringer/core';
import type { DriverSession, Evidence, Fence } from '@wringer/core';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { buildAppURL } from './build-app-url.ts';
import type { SnapshotElement } from './find-snapshot-element.ts';
import { pickBrowserEffect } from './pick-browser-effect.ts';
import { pageStateSchema, snapshotSchema, startBrowserPage } from './start-browser-page.ts';
import type { ElementTarget } from './start-browser-page.ts';

export type PageState = z.infer<typeof pageStateSchema>;

export type PageSnapshot = z.infer<typeof snapshotSchema>;

export interface DescribedElement extends SnapshotElement {
  readonly ref: string;
}

export interface GotoRequest {
  readonly path: string;
}

export interface DescribeRequest {
  readonly ref: string;
}

export type TypeRequest = ElementTarget & { readonly value: string };

export interface BrowserClient {
  readonly goto: (request: GotoRequest) => Promise<PageState>;
  readonly snapshot: () => Promise<PageSnapshot>;
  readonly describe: (request: DescribeRequest) => Promise<DescribedElement>;
  readonly click: (element: ElementTarget) => Promise<PageState>;
  readonly type: (request: TypeRequest) => Promise<PageState>;
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
  readOnly: z.strictObject({ allow: z.array(grantSchema) }).optional(),
});

const describedSchema = z.strictObject({ ref: z.string(), role: z.string(), name: z.string() });
const screenshotSchema = z.strictObject({ png: z.string() });
const statusSchema = z.strictObject({ connected: z.boolean() });

const elementArgsSchema = z
  .strictObject({
    ref: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    name: z.string().optional(),
  })
  .refine((args) => (args.ref === undefined) !== (args.role === undefined), {
    message: 'Pass --ref, or --role with --name.',
  });

const typeArgsSchema = z
  .strictObject({
    ref: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    name: z.string().optional(),
    value: z.string(),
  })
  .refine((args) => (args.ref === undefined) !== (args.role === undefined), {
    message: 'Pass --ref, or --role with --name.',
  });

const evidenceDataSchema = z.strictObject({
  kind: z.string(),
  path: z.string(),
  sha256: z.string(),
});

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
          launchBrowser: () =>
            chromium.launch({
              headless: true,
              ...(ctx.options.executablePath === undefined
                ? {}
                : { executablePath: ctx.options.executablePath }),
            }),
          actionTimeoutMs: ctx.options.actionTimeoutMs,
        }),
    },
  },
  client: (session, fence): BrowserClient => {
    const page = session.service('page');

    const describe = fence({
      effect: () => 'read',
      describe: (request: DescribeRequest) => `browser describe ${request.ref}`,
      run: async (request) => {
        const answer = await page.call('describe', request);

        return describedSchema.parse(answer);
      },
    });

    const describeTarget = (element: ElementTarget): Promise<SnapshotElement> =>
      'ref' in element ? describe({ ref: element.ref }) : Promise.resolve(element);

    const act = makeElementAction(session, fence);

    const snapshot = fence({
      effect: () => 'read',
      describe: () => 'browser snapshot',
      run: async (request: null) => {
        const answer = await page.call('snapshot', request);

        const parsed = snapshotSchema.parse(answer);

        await session.evidence.writeFile('browser', 'snapshot.yaml', parsed.snapshot);

        return parsed;
      },
    });

    const screenshot = fence({
      effect: () => 'read',
      describe: () => 'browser screenshot',
      run: async (request: null) => {
        const answer = await page.call('screenshot', request);

        const parsed = screenshotSchema.parse(answer);

        return session.evidence.writeFile(
          'screenshot',
          'page.png',
          Buffer.from(parsed.png, 'base64'),
        );
      },
    });

    return {
      goto: fence({
        effect: () => 'read',
        describe: (request: GotoRequest) => `browser goto ${request.path}`,
        run: async (request) => {
          const url = buildAppURL(request.path, getBaseURL(session));

          if (url instanceof WringerError) {
            throw url;
          }

          const answer = await page.call('goto', { url });

          return pageStateSchema.parse(answer);
        },
      }),
      snapshot: () => snapshot(null),
      describe,
      click: async (element) => {
        const described = await describeTarget(element);

        return act({ method: 'click', element, described, args: element });
      },
      type: async (request) => {
        const element = pickElementTarget(request);

        const described = await describeTarget(element);

        return act({
          method: 'type',
          element,
          described,
          args: { element, value: request.value },
        });
      },
      screenshot: () => screenshot(null),
    };
  },
  commands: (command) => [
    command({
      path: ['browser', 'goto'],
      summary: 'Open a path of the target app in the browser',
      args: z.strictObject({ path: z.string().startsWith('/') }),
      positionals: ['path'],
      data: pageStateSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.goto(args),
    }),
    command({
      path: ['browser', 'snapshot'],
      summary: 'Print the page as an accessibility tree, with a ref for each element',
      args: z.strictObject({}),
      data: snapshotSchema,
      effect: 'read',
      run: (_args, ctx) => ctx.client.snapshot(),
    }),
    command({
      path: ['browser', 'click'],
      summary: 'Click an element, by --ref from the last snapshot or by --role and --name',
      args: elementArgsSchema,
      data: pageStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config),
      run: (args, ctx) => ctx.client.click(pickElementTarget(args)),
    }),
    command({
      path: ['browser', 'type'],
      summary: 'Type --value into a field, by --ref from the last snapshot or by --role and --name',
      args: typeArgsSchema,
      data: pageStateSchema,
      decideEffect: (args, config) => pickCommandEffect(args, config),
      run: (args, ctx) => ctx.client.type({ ...pickElementTarget(args), value: args.value }),
    }),
    command({
      path: ['browser', 'screenshot'],
      summary: 'Keep a screenshot of the page as evidence',
      args: z.strictObject({}),
      data: evidenceDataSchema,
      effect: 'read',
      run: (_args, ctx) => ctx.client.screenshot(),
    }),
  ],
  checks: [
    {
      name: 'launched',
      timeoutMs: 5000,
      run: async (ctx) => {
        const answer = await ctx.session.service('page').call('status', null);

        const status = statusSchema.parse(answer);

        if (!status.connected) {
          throw new WringerError('check-failed', { message: 'The browser has closed.' });
        }
      },
    },
  ],
});

type BrowserOptions = z.infer<typeof optionsSchema>;

type BrowserConfig = z.infer<typeof targetConfigSchema>;

type BrowserSession = DriverSession<BrowserOptions, BrowserConfig>;

interface ElementAction {
  readonly method: 'click' | 'type';
  readonly element: ElementTarget;
  readonly described: SnapshotElement;
  readonly args: unknown;
}

// The fence decides on the element's role and name, so a ref is described before the call.
function makeElementAction(
  session: BrowserSession,
  fence: Fence,
): (action: ElementAction) => Promise<PageState> {
  return fence({
    effect: (action: ElementAction) =>
      pickBrowserEffect(action.described, session.config.readOnly?.allow ?? []),
    describe: (action) => `${action.method} on ${action.described.role} "${action.described.name}"`,
    run: async (action) => {
      const answer = await session.service('page').call(action.method, action.args);

      return pageStateSchema.parse(answer);
    },
  });
}

function getBaseURL(session: BrowserSession): string {
  const baseURL =
    session.config.baseURL ?? findOwnValue(session.endpoints, session.config.endpoint);

  if (baseURL === undefined) {
    throw new WringerError('usage', {
      message: `Target ${session.target} has no endpoint ${session.config.endpoint}.`,
      hint: 'Set `baseURL` in the browser config of the target, or name an endpoint it has.',
    });
  }

  return baseURL;
}

interface ElementArgs {
  readonly ref?: string | undefined;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
}

function pickElementTarget(args: ElementArgs): ElementTarget {
  if (args.ref !== undefined) {
    return { ref: args.ref };
  }

  return { role: args.role ?? '', name: args.name ?? '' };
}

// The command cannot see a ref's role before it runs, so only an element named by role and name
// can match a grant here; the client call checks a ref once it knows the element.
function pickCommandEffect(args: ElementArgs, config: BrowserConfig): 'read' | 'write' {
  if (args.role === undefined) {
    return 'write';
  }

  return pickBrowserEffect(
    { role: args.role, name: args.name ?? '' },
    config.readOnly?.allow ?? [],
  );
}
