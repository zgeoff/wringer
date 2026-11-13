import { runVerify } from '@wringer/gunshi';
import { createShopRegistry } from './create-shop-registry.ts';

// The example repo's verify CLI. The root `verify` script runs this file, so an agent calls
// `bun verify <command>`.
await runVerify(createShopRegistry({ demoURL: process.env['SHOP_DEMO_URL'] }), {
  skill: '.claude/skills/verify-shop',
  registry: 'packages/shop-example/src/create-shop-registry.ts',
});
