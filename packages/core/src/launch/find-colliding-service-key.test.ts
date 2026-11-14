import { expect, test } from 'bun:test';
import { findCollidingServiceKey } from './find-colliding-service-key.ts';

test.each([
  { name: 'no drivers', drivers: [], key: null },
  {
    name: 'two drivers with a service of one name',
    drivers: [
      { name: 'cache', serviceNames: ['store'] },
      { name: 'queue', serviceNames: ['store'] },
    ],
    key: null,
  },
  {
    name: 'a driver and a service whose names join to the same key',
    drivers: [
      { name: 'cache/main', serviceNames: ['store'] },
      { name: 'cache', serviceNames: ['main/store'] },
    ],
    key: 'cache/main/store',
  },
])('it finds the colliding key $key among $name', (row) => {
  expect(findCollidingServiceKey(row.drivers)).toBe(row.key);
});
