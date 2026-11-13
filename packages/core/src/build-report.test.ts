import { expect, test } from 'bun:test';
import { buildReport } from './build-report.ts';
import type { Verdict } from './report-schema.ts';

function setupTest() {
  const current = 'a'.repeat(40);

  return {
    current,
    older: 'c'.repeat(40),
    buildVerdict: (feature: string, featureFingerprint: string): Verdict => ({
      feature,
      fingerprint: 'b'.repeat(40),
      featureFingerprint,
      run: 'r1',
      at: '2026-11-04T10:00:00.000Z',
      target: { name: 'local', evidence: 'local' },
      pin: { kind: 'local' },
      evidence: [],
    }),
  };
}

test('it marks each feature by whether its own fingerprint changed and its verdict matches', () => {
  const ctx = setupTest();

  const report = buildReport({
    base: 'main',
    fingerprint: 'b'.repeat(40),
    features: [
      { name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] },
      { name: 'search', summary: 'Find', paths: ['src/search/**'] },
      { name: 'cart', summary: 'Hold', paths: ['src/cart/**'] },
      { name: 'account', summary: 'Sign in', paths: ['src/account/**'] },
    ],
    featureFingerprints: new Map([
      ['checkout', ctx.current],
      ['search', ctx.current],
      ['cart', ctx.current],
      ['account', 'empty'],
    ]),
    changedPaths: ['src/checkout/pay.ts', 'src/search/rank.ts', 'src/cart/add.ts'],
    shared: [],
    ignore: [],
    policy: { unpinned: 'allow' },
    verdicts: new Map([
      ['checkout', ctx.buildVerdict('checkout', ctx.current)],
      ['search', ctx.buildVerdict('search', ctx.older)],
    ]),
  });

  expect({
    complete: report.complete,
    statuses: report.features.map((feature) => [feature.name, feature.changed, feature.status]),
  }).toStrictEqual({
    complete: false,
    statuses: [
      ['checkout', true, 'verified'],
      ['search', true, 'stale'],
      ['cart', true, 'missing'],
      ['account', false, 'unchanged'],
    ],
  });
});

test('it keeps a verdict verified when the branch changes only another feature', () => {
  const ctx = setupTest();
  const other = 'd'.repeat(40);

  const report = buildReport({
    base: 'main',
    fingerprint: 'b'.repeat(40),
    features: [
      { name: 'cart', summary: 'Hold', paths: ['src/cart/**'] },
      { name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] },
    ],
    featureFingerprints: new Map([
      ['cart', ctx.current],
      ['checkout', other],
    ]),
    changedPaths: ['src/cart/add.ts', 'src/checkout/pay.ts'],
    shared: [],
    ignore: [],
    policy: { unpinned: 'allow' },
    verdicts: new Map([
      ['cart', ctx.buildVerdict('cart', ctx.current)],
      ['checkout', ctx.buildVerdict('checkout', other)],
    ]),
  });

  expect(report.features.map((feature) => [feature.name, feature.status])).toStrictEqual([
    ['cart', 'verified'],
    ['checkout', 'verified'],
  ]);
});

test('it calls a report complete when every changed feature is verified', () => {
  const ctx = setupTest();

  const report = buildReport({
    base: 'main',
    fingerprint: 'b'.repeat(40),
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    featureFingerprints: new Map([['checkout', ctx.current]]),
    changedPaths: ['src/checkout/pay.ts'],
    shared: [],
    ignore: [],
    policy: { unpinned: 'allow' },
    verdicts: new Map([['checkout', ctx.buildVerdict('checkout', ctx.current)]]),
  });

  expect(report.complete).toBeTrue();
});

test('it lists each changed path that no feature maps as unmapped', () => {
  const ctx = setupTest();

  const report = buildReport({
    base: 'main',
    fingerprint: 'b'.repeat(40),
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    featureFingerprints: new Map([['checkout', ctx.current]]),
    changedPaths: ['scripts/seed.ts', 'src/checkout/pay.ts', 'src/tax.ts'],
    shared: [],
    ignore: [],
    policy: { unpinned: 'allow' },
    verdicts: new Map([['checkout', ctx.buildVerdict('checkout', ctx.current)]]),
  });

  expect({ complete: report.complete, unmapped: report.unmapped }).toStrictEqual({
    complete: false,
    unmapped: ['scripts/seed.ts', 'src/tax.ts'],
  });
});

test('it leaves a changed path that only a shared or an ignore glob matches out of the unmapped paths', () => {
  const report = buildReport({
    base: 'main',
    fingerprint: 'b'.repeat(40),
    features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
    featureFingerprints: new Map([['checkout', 'empty']]),
    changedPaths: ['guide.md', 'package.json', 'src/tax.ts'],
    shared: ['package.json'],
    ignore: ['**/*.md'],
    policy: { unpinned: 'allow' },
    verdicts: new Map(),
  });

  expect({ complete: report.complete, unmapped: report.unmapped }).toStrictEqual({
    complete: false,
    unmapped: ['src/tax.ts'],
  });
});

test('it throws internal when the facts hold no fingerprint for a feature', () => {
  expect(() =>
    buildReport({
      base: 'main',
      fingerprint: 'empty',
      features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
      featureFingerprints: new Map(),
      changedPaths: [],
      shared: [],
      ignore: [],
      policy: { unpinned: 'allow' },
      verdicts: new Map(),
    }),
  ).toThrow(expect.objectContaining({ code: 'internal' }));
});

test.each([
  ['refuse', 'unpinned', false],
  ['allow', 'verified', true],
] as const)(
  'it marks an unpinned verdict as %s under the policy: %s',
  (policy, status, complete) => {
    const ctx = setupTest();

    const report = buildReport({
      base: 'main',
      fingerprint: 'b'.repeat(40),
      features: [{ name: 'checkout', summary: 'Pay', paths: ['src/checkout/**'] }],
      featureFingerprints: new Map([['checkout', ctx.current]]),
      changedPaths: ['src/checkout/pay.ts'],
      shared: [],
      ignore: [],
      policy: { unpinned: policy },
      verdicts: new Map([
        ['checkout', { ...ctx.buildVerdict('checkout', ctx.current), pin: { kind: 'unpinned' } }],
      ]),
    });

    expect({ status: report.features[0]?.status, complete: report.complete }).toStrictEqual({
      status,
      complete,
    });
  },
);
