import { expect, test } from 'bun:test';
import { collectFeatureScopes } from './collect-feature-scopes.ts';

test('it gives each feature its own paths, then every shared glob', () => {
  const scopes = collectFeatureScopes({
    features: [
      { name: 'cart', summary: 'Add items', paths: ['src/cart/**'] },
      { name: 'checkout', summary: 'Pay', paths: ['src/checkout/**', 'src/pay.ts'] },
    ],
    shared: ['package.json', 'verify/**'],
  });

  expect(scopes).toStrictEqual([
    { name: 'cart', globs: ['src/cart/**', 'package.json', 'verify/**'] },
    { name: 'checkout', globs: ['src/checkout/**', 'src/pay.ts', 'package.json', 'verify/**'] },
  ]);
});
