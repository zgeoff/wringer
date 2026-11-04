import { join } from 'node:path';
import { browser } from '../packages/browser/src/index.ts';
import { bindDrivers, createWringer, local } from '../packages/core/src/index.ts';
import type { Wringer } from '../packages/core/src/index.ts';
import { db } from '../packages/db/src/index.ts';
import { http } from '../packages/http/src/index.ts';
import { stream } from '../packages/stream/src/index.ts';

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
