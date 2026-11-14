import type { Wringer } from '@wringer/core';
import { buildShopBase } from './build-shop-base.ts';
import type { ShopRegistryOptions } from './build-shop-base.ts';

// The example repo's verify registry: the shop base, the shop's feature map with root-relative
// paths as git lists them, and the paths the gate ignores.
export function createShopRegistry(options: ShopRegistryOptions = {}): Wringer {
  return buildShopBase('shop', options)
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
    )
    .shared(
      'packages/shop-example/package.json',
      'packages/shop-example/src/build-shop-base.ts',
      'packages/shop-example/src/create-shop-registry.ts',
      'packages/shop-example/src/verify-shop.ts',
    )
    .ignore(
      '**/*.md',
      '**/*.test.ts',
      'docs/**',
      '.github/**',
      '.claude/**',
      '.lefthook/**',
      'scripts/**',
      '*',
      'packages/{browser,core,db,gunshi,http,stream,terminal}/**',
      'packages/shop-example/{tsconfig.json,e2e/**,src/create-wringer-registry.ts,src/shop-tui.ts,src/verify-wringer.ts}',
    )
    .build();
}
