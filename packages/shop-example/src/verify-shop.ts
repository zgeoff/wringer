import { runVerify } from '@wringer/gunshi';
import { createShopRegistry } from './create-shop-registry.ts';

// The shop example's own verify CLI. The `verify:shop` script runs this file.
await runVerify(createShopRegistry({ demoURL: process.env['SHOP_DEMO_URL'] }), {
  skill: '.claude/skills/verify-shop',
  registry: 'packages/shop-example/src/create-shop-registry.ts',
});
