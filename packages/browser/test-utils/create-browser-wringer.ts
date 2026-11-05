import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { browser } from '../src/browser.ts';

const emptySchema = z.strictObject({});
const titleSchema = z.strictObject({ title: z.string() });
const buttonSchema = z.strictObject({ button: z.string() });

// A verify CLI against the shop page at `url`: `local` may write, read-only `prod` grants the Search
// button and field, and actions claim a read, then click Place order, a button by its snapshot
// ref, or type an email.
export function createBrowserWringer(url: string): Wringer {
  const shop = bindDrivers([browser({})] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { browser: () => ({}) },
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
