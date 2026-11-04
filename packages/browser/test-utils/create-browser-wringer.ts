import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { browser } from '../src/browser.ts';

const emptySchema = z.strictObject({});
const titleSchema = z.strictObject({ title: z.string() });

// A repo's verify CLI for the browser driver's tests, against the shop page at `url`: an attach
// target `local` that may write, a read-only target `prod` that grants the Search button, and an
// action that claims a read and then clicks Place order.
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
          browser: () => ({ readOnly: { allow: [{ role: 'button', name: 'Search' }] } }),
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
