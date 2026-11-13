import { expect, test } from 'bun:test';
import { createCoverWringer } from './create-cover-wringer.ts';

test('it builds a registry with the options as its shared globs and the cart paths', () => {
  const wringer = createCoverWringer({ shared: ['package.json'], paths: ['lib/**'] });

  expect({
    shared: wringer.shared,
    ignore: wringer.ignore,
    paths: wringer.features.map((feature) => feature.paths),
  }).toStrictEqual({ shared: ['package.json'], ignore: ['verify/**'], paths: [['lib/**']] });
});
