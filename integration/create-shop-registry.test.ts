import { expect, test } from 'bun:test';
import { createShopRegistry } from './create-shop-registry.ts';

test('it builds a launch target with the http, db, stream and browser drivers and a checkout feature', () => {
  const registry = createShopRegistry();

  expect({
    targets: [...registry.targets.entries()].map(([name, target]) => [name, target.mode]),
    drivers: registry.drivers.map((driver) => driver.name),
    features: registry.features.map((feature) => feature.name),
  }).toStrictEqual({
    targets: [['local', 'launch']],
    drivers: ['http', 'db', 'stream', 'browser'],
    features: ['checkout'],
  });
});
