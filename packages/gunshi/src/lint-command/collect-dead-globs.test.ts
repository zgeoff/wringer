import { expect, test } from 'bun:test';
import { createCoverWringer } from '../test-utils/create-cover-wringer.ts';
import { collectDeadGlobs } from './collect-dead-globs.ts';

test('it returns each feature, shared and ignore glob that matches no file, with its place', () => {
  const wringer = createCoverWringer({
    paths: ['src/**', 'src/kettle.ts'],
    shared: ['package.json'],
    ignore: ['docs/**'],
  });

  expect(collectDeadGlobs(wringer, ['src/cart.ts', 'README.md'])).toStrictEqual([
    { where: 'feature cart', glob: 'src/kettle.ts' },
    { where: 'shared', glob: 'package.json' },
    { where: 'ignore', glob: 'docs/**' },
  ]);
});

test('it returns nothing when every glob matches a file', () => {
  const wringer = createCoverWringer({ paths: ['src/**/*.ts'], ignore: ['verify/**'] });

  expect(collectDeadGlobs(wringer, ['src/brew/steep.ts', 'verify/a.ts'])).toStrictEqual([]);
});
