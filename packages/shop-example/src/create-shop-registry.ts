import { join } from 'node:path';
import { browser } from '@wringer/browser';
import { WringerError, bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { db } from '@wringer/db';
import { http } from '@wringer/http';
import { stream } from '@wringer/stream';
import { z } from 'zod';
import { ordersSchema, placedOrderSchema } from './shop-contract.ts';

export interface ShopRegistryOptions {
  // The URL of a shop that runs apart from wringer, which the read-only `demo` target attaches to.
  readonly demoURL?: string | undefined;
}

const orderCountSchema = z.strictObject({ orders: z.number().int().nonnegative() });

// The example repo's verify registry: a launch target that starts the shop app with its database in
// the run folder, a read-only attach target for a shop started apart, all four drivers, the shop's
// feature map with root-relative paths as git lists them, and the paths the gate ignores.
export function createShopRegistry(options: ShopRegistryOptions = {}): Wringer {
  const shop = bindDrivers([http({}), db({}), stream({}), browser({})] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
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
    })
    .feature(
      {
        name: 'place-order',
        summary: 'Place an order from the shop page',
        paths: [
          'packages/shop-example/src/shop-page.html',
          'packages/shop-example/src/shop-page.ts',
        ],
      },
      {
        name: 'order-failure',
        summary: 'Show on the page that an order failed',
        paths: ['packages/shop-example/src/shop-page.ts'],
      },
      {
        name: 'list-orders',
        summary: 'List the placed orders through the orders API',
        paths: [
          'packages/shop-example/src/shop-app.ts',
          'packages/shop-example/src/shop-contract.ts',
        ],
      },
      {
        name: 'order-log',
        summary: 'Log one line for each order placed',
        paths: ['packages/shop-example/src/shop-app.ts'],
      },
      {
        name: 'guide',
        summary: 'Print the guide for adding a verify CLI, or one of its topics',
        paths: [
          'packages/gunshi/src/build-guide-command.ts',
          'packages/gunshi/src/pick-guide-data.ts',
          'packages/gunshi/src/read-guide.ts',
        ],
      },
    )
    .ignore('**/*.md', '**/*.test.ts', 'docs/**', '.github/**', '.claude/**')
    .build();
}
