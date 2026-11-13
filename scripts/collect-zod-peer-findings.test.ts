import { expect, test } from 'bun:test';
import { collectZodPeerFindings } from './collect-zod-peer-findings.ts';

test('it finds nothing in a published package that takes zod as a peer through the catalog', () => {
  const findings = collectZodPeerFindings([
    {
      path: 'packages/ledger/package.json',
      manifest: {
        name: '@wringer/ledger',
        devDependencies: { zod: 'catalog:' },
        peerDependencies: { zod: '^4.0.0' },
      },
    },
  ]);

  expect(findings).toStrictEqual([]);
});

test('it reports a published package that lists zod as a dependency', () => {
  const findings = collectZodPeerFindings([
    {
      path: 'packages/ledger/package.json',
      manifest: { name: '@wringer/ledger', dependencies: { zod: 'catalog:' } },
    },
  ]);

  expect(findings).toStrictEqual([
    'packages/ledger/package.json: peerDependencies.zod is absent, expected "^4.0.0"',
    'packages/ledger/package.json: dependencies.zod is "catalog:", expected absent',
    'packages/ledger/package.json: devDependencies.zod is absent, expected "catalog:"',
  ]);
});

test('it reports a published package whose zod peer range is an exact pin', () => {
  const findings = collectZodPeerFindings([
    {
      path: 'packages/ledger/package.json',
      manifest: {
        name: '@wringer/ledger',
        devDependencies: { zod: 'catalog:' },
        peerDependencies: { zod: '4.1.0' },
      },
    },
  ]);

  expect(findings).toStrictEqual([
    'packages/ledger/package.json: peerDependencies.zod is "4.1.0", expected "^4.0.0"',
  ]);
});

test('it skips a private package that lists zod as a dependency', () => {
  const findings = collectZodPeerFindings([
    {
      path: 'packages/ledger/package.json',
      manifest: {
        name: '@wringer/ledger',
        devDependencies: { zod: 'catalog:' },
        peerDependencies: { zod: '^4.0.0' },
      },
    },
    {
      path: 'packages/storefront/package.json',
      manifest: { name: '@wringer/storefront', private: true, dependencies: { zod: 'catalog:' } },
    },
  ]);

  expect(findings).toStrictEqual([]);
});

test('it reports a manifest that holds no object as a published package without zod', () => {
  const findings = collectZodPeerFindings([{ path: 'packages/ledger/package.json', manifest: [] }]);

  expect(findings).toStrictEqual([
    'packages/ledger/package.json: peerDependencies.zod is absent, expected "^4.0.0"',
    'packages/ledger/package.json: devDependencies.zod is absent, expected "catalog:"',
  ]);
});

test('it reports a repo with no published package', () => {
  const findings = collectZodPeerFindings([
    {
      path: 'packages/storefront/package.json',
      manifest: { name: '@wringer/storefront', private: true },
    },
  ]);

  expect(findings).toStrictEqual(['packages: no published package manifest found']);
});
