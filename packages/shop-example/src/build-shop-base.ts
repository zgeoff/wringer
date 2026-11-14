import { join } from 'node:path';
import { browser } from '@wringer/browser';
import { WringerError, bindDrivers, createWringer, local } from '@wringer/core';
import { db } from '@wringer/db';
import { http } from '@wringer/http';
import { stream } from '@wringer/stream';
import { terminal } from '@wringer/terminal';
import { z } from 'zod';
import { ordersSchema, placedOrderSchema } from './shop-contract.ts';

export interface ShopRegistryOptions {
  // The URL of a shop that runs apart from wringer, which the read-only `demo` target attaches to.
  readonly demoURL?: string | undefined;
}

export interface ShopBaseOptions extends ShopRegistryOptions {
  // Whether the `local` target puts its evidence in the PR description. The default keeps it local.
  readonly evidence?: 'upload' | 'local' | undefined;
}

const orderCountSchema = z.strictObject({ orders: z.number().int().nonnegative() });

// What every registry over the shop app shares, defined once: the shop's API token, a launch target
// for the shop app with its database in the run folder, a read-only attach target for a shop started
// apart, all five drivers, the action, command and doctor check, and no features.
export function buildShopBase(name: string, options: ShopBaseOptions = {}) {
  const shop = bindDrivers([http({}), db({}), stream({}), browser({}), terminal({})] as const);

  return createWringer({ name })
    .secret('SHOP_API_TOKEN')
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
        evidence: options.evidence,
        host: local(),
        launch: (ctx) => ({
          command: ['bun', join(import.meta.dir, 'shop-app.ts')],
          env: { SHOP_DB: join(ctx.runDirectory, 'shop.db') },
          ready: (line) =>
            line['event'] === 'listening'
              ? { web: `http://127.0.0.1:${String(line['port'])}` }
              : null,
        }),
        drivers: {
          http: () => ({}),
          db: (ctx) => ({
            via: 'sql',
            adapter: 'sqlite',
            url: join(ctx.run.paths.directory, 'shop.db'),
          }),
          stream: () => ({}),
          browser: () => ({}),
          terminal: (ctx) => ({
            programs: {
              tui: {
                command: ['bun', join(import.meta.dir, 'shop-tui.ts')],
                env: { SHOP_URL: ctx.endpoints['web'] ?? '' },
              },
            },
          }),
        },
      }),
    )
    .target(
      'demo',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint:
          'The demo shop is read-only. Leave the write undone, skip `done` for this feature, and report the write you needed.',
        host: local(),
        endpoints: () => {
          if (options.demoURL === undefined) {
            throw new WringerError('usage', {
              message: 'The demo target has no URL.',
              hint: 'Set SHOP_DEMO_URL to the URL of a running shop.',
            });
          }

          return { web: options.demoURL };
        },
        drivers: { http: () => ({}), browser: () => ({}) },
      }),
    )
    .action({
      name: 'place-order',
      summary: 'Place one order through the orders API',
      effect: 'write',
      input: z.strictObject({}),
      data: placedOrderSchema,
      run: async (_input, ctx) => {
        const response = await ctx.drivers.http.request({ method: 'POST', path: '/api/orders' });

        return placedOrderSchema.parse(response.json);
      },
    })
    .command({
      path: ['orders', 'count'],
      summary: 'Count the orders in the shop database',
      args: z.strictObject({}),
      data: orderCountSchema,
      effect: 'read',
      run: async (_args, ctx) => {
        const result = await ctx.drivers.db.query({
          sql: 'select count(*) as orders from orders',
        });

        return orderCountSchema.parse(result.rows[0]);
      },
    })
    .check({
      name: 'orders-api',
      input: z.strictObject({}),
      data: ordersSchema,
      timeoutMs: 5000,
      run: async (_input, ctx) => {
        const response = await ctx.drivers.http.request({ path: '/api/orders' });

        return ordersSchema.parse(response.json);
      },
    });
}
