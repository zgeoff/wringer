import { expect, test } from 'bun:test';
import { buildReport } from './build-report.ts';

test('it marks each feature by whether the branch changed it and its verdict matches', () => {
  const report = buildReport({
    base: 'main',
    fingerprint: 'f2',
    features: [
      { name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] },
      { name: 'search', summary: 'Find', paths: ['src/search/**'] },
      { name: 'cart', summary: 'Hold', paths: ['src/cart/**'] },
      { name: 'account', summary: 'Sign in', paths: ['src/account/**'] },
    ],
    changedPaths: ['src/checkout/pay.ts', 'src/search/rank.ts', 'src/cart/add.ts'],
    verdicts: new Map([
      [
        'checkout',
        {
          feature: 'checkout',
          fingerprint: 'f2',
          run: 'r1',
          at: '2026-11-04T10:00:00.000Z',
          evidence: [],
        },
      ],
      [
        'search',
        {
          feature: 'search',
          fingerprint: 'f1',
          run: 'r1',
          at: '2026-11-04T10:00:00.000Z',
          evidence: [],
        },
      ],
    ]),
  });

  expect({
    complete: report.complete,
    statuses: report.features.map((feature) => [feature.name, feature.status]),
  }).toStrictEqual({
    complete: false,
    statuses: [
      ['checkout', 'verified'],
      ['search', 'stale'],
      ['cart', 'missing'],
      ['account', 'unchanged'],
    ],
  });
});

test('it calls a report complete when every changed feature is verified', () => {
  const report = buildReport({
    base: 'main',
    fingerprint: 'f2',
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    changedPaths: ['src/checkout/pay.ts'],
    verdicts: new Map([
      [
        'checkout',
        {
          feature: 'checkout',
          fingerprint: 'f2',
          run: 'r1',
          at: '2026-11-04T10:00:00.000Z',
          evidence: [],
        },
      ],
    ]),
  });

  expect(report.complete).toBeTrue();
});
