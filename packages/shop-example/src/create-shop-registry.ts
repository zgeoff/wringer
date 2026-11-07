import { join } from 'node:path';
import { browser } from '@wringer/browser';
import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { db } from '@wringer/db';
import { http } from '@wringer/http';
import { stream } from '@wringer/stream';

// The example repo's verify registry: a launch target that starts the shop app with its database in
// the run folder, all four drivers, and a checkout feature over `src/checkout/`.
export function createShopRegistry(): Wringer {
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
    .feature({ name: 'checkout', summary: 'Placing an order', paths: ['src/checkout/**'] })
    .build();
}
