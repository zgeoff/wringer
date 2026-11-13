import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dispatch, reportSchema } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { z } from 'zod';
import { createShopRegistry } from './create-shop-registry.ts';

async function setupTest() {
  const reportDataSchema = z.strictObject({ report: reportSchema, markdown: z.string() });
  const registry = createShopRegistry();

  const shop = await createTestSession({ parent: import.meta.dir, wringer: registry });

  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(shop.repo.root, path)), { recursive: true });
    await writeFile(join(shop.repo.root, path), text);
  };

  return {
    write,

    run: (path: readonly string[], args: unknown = {}) =>
      dispatch(registry, path, args, { ...shop.session, target: 'local' }),
    readStatuses: async () => {
      const result = await dispatch(registry, ['report'], {}, { ...shop.session, target: 'local' });

      const data = reportDataSchema.parse(result.envelope.data);

      return data.report.features.map((feature) => [feature.name, feature.status]);
    },
  };
}

test('#report keeps a verdict on place-order verified after an edit to the orders API file', async () => {
  const ctx = await setupTest();

  await ctx.write('packages/shop-example/src/shop-page.ts', 'export const page = 1;\n');
  await ctx.write('packages/shop-example/src/shop-app.ts', 'export const app = 1;\n');
  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'place-order' });
  await ctx.run(['action', 'place-order']);
  await ctx.run(['done']);
  await ctx.write('packages/shop-example/src/shop-app.ts', 'export const app = 2;\n');

  const statuses = await ctx.readStatuses();

  expect(statuses).toStrictEqual([
    ['place-order', 'verified'],
    ['order-failure', 'missing'],
    ['list-orders', 'missing'],
    ['order-log', 'missing'],
    ['guide', 'unchanged'],
  ]);
});

test('#report marks a verdict on place-order stale after an edit to the page it covers', async () => {
  const ctx = await setupTest();

  await ctx.write('packages/shop-example/src/shop-page.ts', 'export const page = 1;\n');
  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'place-order' });
  await ctx.run(['action', 'place-order']);
  await ctx.run(['done']);
  await ctx.write('packages/shop-example/src/shop-page.ts', 'export const page = 2;\n');

  const statuses = await ctx.readStatuses();

  expect(statuses).toStrictEqual([
    ['place-order', 'stale'],
    ['order-failure', 'missing'],
    ['list-orders', 'unchanged'],
    ['order-log', 'unchanged'],
    ['guide', 'unchanged'],
  ]);
});
