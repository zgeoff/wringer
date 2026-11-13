import { expect, test } from 'bun:test';
import { createShopRegistry } from './create-shop-registry.ts';

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
    features: ['place-order', 'order-failure', 'list-orders', 'order-log'],
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
