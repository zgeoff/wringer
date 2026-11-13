import { runVerify } from '@wringer/gunshi';
import { createWringerRegistry } from './create-wringer-registry.ts';

// wringer's own verify CLI. The root `verify` script runs this file, so an agent calls
// `bun verify <command>`.
await runVerify(createWringerRegistry({ demoURL: process.env['SHOP_DEMO_URL'] }), {
  skill: '.claude/skills/verify',
  registry: 'packages/shop-example/src/create-wringer-registry.ts',
});
