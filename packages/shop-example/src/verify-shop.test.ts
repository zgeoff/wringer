import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';

function setupTest() {
  // Commands such as `lint` read the repo's own files, so the script runs from the repo root, as CI
  // would call it.
  const root = join(import.meta.dir, '..', '..', '..');

  return {
    runVerify: async (...args: readonly string[]) => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'verify-shop.ts'), ...args, '--json'],
        { cwd: root, stdout: 'pipe', stderr: 'pipe' },
      );

      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      return { exitCode, data: envelopeSchema.parse(JSON.parse(stdout)).data, stderr };
    },
  };
}

test('it passes lint over the shop verify skill and its feature map', async () => {
  const ctx = setupTest();

  const result = await ctx.runVerify('lint');

  expect(result).toStrictEqual({
    exitCode: 0,
    data: { skill: 'packages/shop-example/verify-skill/SKILL.md', commands: 17, failures: [] },
    stderr: '',
  });
});

test('#features --markdown lists the shop features, the ignore list and the feature table', async () => {
  const ctx = setupTest();

  const result = await ctx.runVerify('features', '--markdown');

  expect(result).toStrictEqual({
    exitCode: 0,
    data: {
      features: [
        {
          name: 'place-order',
          summary: 'Place an order from the shop page',
          paths: [
            'packages/shop-example/src/shop-page.html',
            'packages/shop-example/src/shop-page.ts',
          ],
          file: 'references/feature-place-order.md',
        },
        {
          name: 'order-failure',
          summary: 'Show on the page that an order failed',
          paths: ['packages/shop-example/src/shop-page.ts'],
          file: 'references/feature-order-failure.md',
        },
        {
          name: 'list-orders',
          summary: 'List the placed orders through the orders API',
          paths: [
            'packages/shop-example/src/shop-app.ts',
            'packages/shop-example/src/shop-contract.ts',
          ],
          file: 'references/feature-list-orders.md',
        },
        {
          name: 'order-log',
          summary: 'Log one line for each order placed',
          paths: ['packages/shop-example/src/shop-app.ts'],
          file: 'references/feature-order-log.md',
        },
      ],
      shared: [
        'packages/shop-example/package.json',
        'packages/shop-example/src/build-shop-base.ts',
        'packages/shop-example/src/create-shop-registry.ts',
        'packages/shop-example/src/verify-shop.ts',
      ],
      ignore: [
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
      ],
      markdown: [
        '| Feature | Summary | File |',
        '| --- | --- | --- |',
        '| place-order | Place an order from the shop page | [references/feature-place-order.md](references/feature-place-order.md) |',
        '| order-failure | Show on the page that an order failed | [references/feature-order-failure.md](references/feature-order-failure.md) |',
        '| list-orders | List the placed orders through the orders API | [references/feature-list-orders.md](references/feature-list-orders.md) |',
        '| order-log | Log one line for each order placed | [references/feature-order-log.md](references/feature-order-log.md) |',
      ].join('\n'),
    },
    stderr: '',
  });
});

test('#features omits the feature table without --markdown', async () => {
  const ctx = setupTest();

  const result = await ctx.runVerify('features');

  expect(result.data).not.toHaveProperty('markdown');
});
