import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { browser } from '../browser.ts';

const emptySchema = z.strictObject({});
const titleSchema = z.strictObject({ title: z.string() });
const buttonSchema = z.strictObject({ button: z.string() });

export interface BrowserWringerOptions {
  readonly adminURL?: string;
  readonly actionTimeoutMs?: number;
}

// A verify CLI against the shop page at `url` and the admin page at `adminURL`. Read-only `tour` and
// `wide` grant the Open admin link, and only `wide` lists `admin`; `inherited` names an endpoint
// every object inherits. Actions claim a read, then click, or type.
export function createBrowserWringer(url: string, options: BrowserWringerOptions = {}): Wringer {
  const adminURL = options.adminURL ?? url;

  const shop = bindDrivers([
    browser({ actionTimeoutMs: options.actionTimeoutMs ?? 10_000 }),
  ] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url, admin: adminURL }),
        drivers: { browser: () => ({ endpoints: ['admin'] }) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'prod is read-only: place the order on local.',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: {
          browser: () => ({
            readOnly: {
              allow: [
                { role: 'button', name: 'Search' },
                { role: 'textbox', name: 'Search terms' },
              ],
            },
          }),
        },
      }),
    )
    .target(
      'tour',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'tour is read-only: place the order on local.',
        host: local(),
        endpoints: () => ({ web: url, admin: adminURL }),
        drivers: {
          browser: () => ({
            readOnly: {
              allow: [
                { role: 'button', name: 'Search' },
                { role: 'link', name: 'Open admin' },
                { role: 'textbox', name: 'Email' },
              ],
            },
          }),
        },
      }),
    )
    .target(
      'wide',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'wide is read-only: place the order on local.',
        host: local(),
        endpoints: () => ({ web: url, admin: adminURL }),
        drivers: {
          browser: () => ({
            endpoints: ['admin'],
            readOnly: {
              allow: [
                { role: 'button', name: 'Search' },
                { role: 'link', name: 'Open admin' },
              ],
            },
          }),
        },
      }),
    )
    .target(
      'inherited',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { browser: () => ({ endpoint: 'constructor' }) },
      }),
    )
    .action(
      shop.defineAction({
        name: 'sneak-order',
        summary: 'Claim a read, then click Place order',
        effect: 'read',
        input: emptySchema,
        data: titleSchema,
        run: async (_input, ctx) => {
          await ctx.drivers.browser.goto({ path: '/' });

          const page = await ctx.drivers.browser.click({ role: 'button', name: 'Place order' });

          return { title: page.title };
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'sneak-email',
        summary: 'Claim a read, then type an email address',
        effect: 'read',
        input: emptySchema,
        data: titleSchema,
        run: async (_input, ctx) => {
          await ctx.drivers.browser.goto({ path: '/' });

          const page = await ctx.drivers.browser.type({
            role: 'textbox',
            name: 'Email',
            value: 'buyer@shop.example',
          });

          return { title: page.title };
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'click-by-ref',
        summary: 'Claim a read, then click a button by the ref a snapshot printed for it',
        effect: 'read',
        input: buttonSchema,
        data: titleSchema,
        run: async (input, ctx) => {
          await ctx.drivers.browser.goto({ path: '/' });

          const printed = await ctx.drivers.browser.snapshot();

          const refPattern = new RegExp(`button "${input.button}" \\[ref=(?<ref>e\\d+)\\]`, 'u');

          const ref = refPattern.exec(printed.snapshot)?.groups?.['ref'] ?? 'missing';

          const page = await ctx.drivers.browser.click({ ref });

          return { title: page.title };
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'script-order',
        summary: 'Claim a read, then open a script URL that clicks Place order',
        effect: 'read',
        input: emptySchema,
        data: titleSchema,
        run: async (_input, ctx) => {
          await ctx.drivers.browser.goto({ path: '/' });

          const page = await ctx.drivers.browser.goto({
            // oxlint-disable-next-line no-script-url -- the driver must refuse this URL
            path: 'javascript:document.querySelector("button").click()',
          });

          return { title: page.title };
        },
      }),
    )
    .build();
}
