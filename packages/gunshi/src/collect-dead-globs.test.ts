import { expect, test } from 'bun:test';
import { collectDeadGlobs } from './collect-dead-globs.ts';

test('it returns each glob that matches no file, with its feature', () => {
  const features = [
    { name: 'brew', summary: 'Brew a pot', paths: ['src/brew/**', 'src/kettle.ts'] },
    { name: 'pour', summary: 'Pour a cup', paths: ['src/pour/**'] },
  ];

  expect(collectDeadGlobs(features, ['src/brew/steep.ts', 'README.md'])).toStrictEqual([
    { feature: 'brew', glob: 'src/kettle.ts' },
    { feature: 'pour', glob: 'src/pour/**' },
  ]);
});

test('it returns nothing when every glob matches a file', () => {
  const features = [{ name: 'brew', summary: 'Brew a pot', paths: ['src/**/*.ts'] }];

  expect(collectDeadGlobs(features, ['src/brew/steep.ts'])).toStrictEqual([]);
});
