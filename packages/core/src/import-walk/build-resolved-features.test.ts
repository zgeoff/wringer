import { expect, test } from 'bun:test';
import { buildResolvedFeatures } from './build-resolved-features.ts';

test('it widens paths with extra and each escaped reached file, and leaves a feature with no reach alone', () => {
  const features = [
    { name: 'a', summary: 's', entries: ['x'], extra: ['journeys/**'], paths: ['own/**'] },
    { name: 'b', summary: 's', entries: [], extra: [], paths: ['b/**'] },
  ];

  const reach = new Map([['a', { reached: ['src/[id].ts'], warnings: [] }]]);

  expect(buildResolvedFeatures(features, reach).map((feature) => feature.paths)).toStrictEqual([
    ['own/**', 'journeys/**', String.raw`src/\[id\].ts`],
    ['b/**'],
  ]);
});
