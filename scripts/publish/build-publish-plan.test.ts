import { expect, test } from 'bun:test';
import { buildPublishPlan } from './build-publish-plan.ts';

test('it readies every manifest when none is invalid and each public one holds its released version', () => {
  const plan = buildPublishPlan([
    { kind: 'private', folder: '/repo', name: 'kettle-workspace' },
    {
      kind: 'public',
      folder: '/repo/packages/kettle',
      name: '@acme/kettle',
      version: '1.2.0',
      hasBuild: false,
      releasedVersion: '1.2.0',
    },
  ]);

  expect(plan).toStrictEqual({
    kind: 'ready',
    manifests: [
      { kind: 'private', folder: '/repo', name: 'kettle-workspace' },
      {
        kind: 'public',
        folder: '/repo/packages/kettle',
        name: '@acme/kettle',
        version: '1.2.0',
        hasBuild: false,
        releasedVersion: '1.2.0',
      },
    ],
  });
});

test('it refuses the whole plan with each invalid manifest and each version the release did not tag', () => {
  const plan = buildPublishPlan([
    { kind: 'invalid', message: '/repo/packages/teapot/package.json holds no JSON object' },
    {
      kind: 'public',
      folder: '/repo/packages/kettle',
      name: '@acme/kettle',
      version: '1.1.9',
      hasBuild: false,
      releasedVersion: '1.2.0',
    },
  ]);

  expect(plan).toStrictEqual({
    kind: 'refused',
    faults: [
      '/repo/packages/teapot/package.json holds no JSON object',
      '@acme/kettle: the release tagged 1.2.0 but /repo/packages/kettle/package.json holds 1.1.9',
    ],
  });
});

test('it readies a public manifest that names no released version', () => {
  const plan = buildPublishPlan([
    {
      kind: 'public',
      folder: '/repo/packages/kettle',
      name: '@acme/kettle',
      version: '1.1.9',
      hasBuild: true,
      releasedVersion: undefined,
    },
  ]);

  expect(plan).toStrictEqual({
    kind: 'ready',
    manifests: [
      {
        kind: 'public',
        folder: '/repo/packages/kettle',
        name: '@acme/kettle',
        version: '1.1.9',
        hasBuild: true,
        releasedVersion: undefined,
      },
    ],
  });
});
