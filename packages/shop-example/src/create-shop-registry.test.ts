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

test('it builds the local and demo targets with the four drivers, the shop features and the ignore list', () => {
  const registry = createShopRegistry();

  expect({
    targets: [...registry.targets.entries()].map(([name, target]) => [
      name,
      target.mode,
      target.access,
    ]),
    drivers: registry.drivers.map((driver) => driver.name),
    features: registry.features.map((feature) => feature.name),
    ignore: registry.ignore,
  }).toStrictEqual({
    targets: [
      ['local', 'launch', 'read-write'],
      ['demo', 'attach', 'read-only'],
    ],
    drivers: ['http', 'db', 'stream', 'browser'],
    features: ['place-order', 'order-failure', 'list-orders', 'order-log', 'guide'],
    ignore: ['**/*.md', '**/*.test.ts', 'docs/**', '.github/**', '.claude/**'],
  });
});

test('it attaches the demo target to the URL it is given', async () => {
  const registry = createShopRegistry({ demoURL: 'http://127.0.0.1:4310' });
  const demo = registry.targets.get('demo');

  const endpoints = await demo?.endpoints?.({ target: 'demo' });

  expect(endpoints).toStrictEqual({ web: 'http://127.0.0.1:4310' });
});

test('it refuses to attach the demo target with a usage error when it has no URL', () => {
  const registry = createShopRegistry();
  const demo = registry.targets.get('demo');

  expect(() => demo?.endpoints?.({ target: 'demo' })).toThrow(
    expect.objectContaining({ code: 'usage' }),
  );
});

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
