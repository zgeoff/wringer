import { expect, test } from 'bun:test';
import { buildDeployedPin } from './build-deployed-pin.ts';

test('#buildDeployedPin leaves a verdict unpinned when the target names no deployed commit', () => {
  const wringer = {
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    shared: [],
  };

  expect(
    buildDeployedPin(wringer, {
      feature: 'checkout',
      deployed: null,
      deployedPaths: ['src/checkout/pay.ts'],
    }),
  ).toStrictEqual({ kind: 'unpinned' });
});

test('#buildDeployedPin pins when every differing path lies outside the scope', () => {
  const wringer = {
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    shared: ['package.json'],
  };

  expect(
    buildDeployedPin(wringer, {
      feature: 'checkout',
      deployed: '5e1d0a7',
      deployedPaths: ['src/search/find.ts'],
    }),
  ).toStrictEqual({ kind: 'deployed', revision: '5e1d0a7' });
});

test.each(['src/checkout/pay.ts', 'package.json'])(
  '#buildDeployedPin refuses when %s differs inside the scope',
  (differing) => {
    const wringer = {
      features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
      shared: ['package.json'],
    };

    expect(() =>
      buildDeployedPin(wringer, {
        feature: 'checkout',
        deployed: '5e1d0a7',
        deployedPaths: [differing],
      }),
    ).toThrow(expect.objectContaining({ code: 'check-failed' }));
  },
);
