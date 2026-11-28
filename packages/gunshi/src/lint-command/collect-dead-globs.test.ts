import { expect, test } from 'bun:test';
import { createWringer, local } from '@wringer/core';
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

test('it returns an entries glob that matches no file, and accepts an entry that names a folder', () => {
  const wringer = createWringer({ name: 'cover' })
    .target('local', { mode: 'attach', access: 'read-only', host: local() })
    .feature({
      name: 'cart',
      summary: 'Add items',
      entries: ['src/cart', 'src/gone.ts'],
      extra: ['journeys/**'],
    })
    .build();

  expect(collectDeadGlobs(wringer, ['src/cart/add.ts'])).toStrictEqual([
    { where: 'feature cart entries', glob: 'src/gone.ts' },
    { where: 'feature cart extra', glob: 'journeys/**' },
  ]);
});
