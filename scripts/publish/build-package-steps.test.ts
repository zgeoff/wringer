import { expect, test } from 'bun:test';
import { buildPackageSteps } from './build-package-steps.ts';

test('it probes the registry and publishes the manifest as it is with provenance', () => {
  const steps = buildPackageSteps(
    {
      kind: 'public',
      folder: '/repo/packages/kettle',
      name: '@acme/kettle',
      version: '1.2.0',
      hasBuild: false,
      releasedVersion: '1.2.0',
    },
    'publish',
  );

  expect(steps).toStrictEqual({
    probeRegistry: true,
    build: false,
    packVersion: null,
    publishArgs: ['--provenance', '--access', 'public'],
  });
});

test('it rehearses a prerelease of the version as a dry run under its own dist-tag, with no registry probe', () => {
  const steps = buildPackageSteps(
    {
      kind: 'public',
      folder: '/repo/packages/kettle',
      name: '@acme/kettle',
      version: '1.2.0',
      hasBuild: false,
      releasedVersion: undefined,
    },
    'rehearse',
  );

  expect(steps).toStrictEqual({
    probeRegistry: false,
    build: false,
    packVersion: '1.2.0-rehearsal',
    publishArgs: ['--dry-run', '--tag', 'rehearsal', '--access', 'public'],
  });
});

test.each(['publish', 'rehearse'] as const)(
  'it builds a package that has a build script before the %s pack',
  (mode) => {
    const steps = buildPackageSteps(
      {
        kind: 'public',
        folder: '/repo/packages/kettle',
        name: '@acme/kettle',
        version: '1.2.0',
        hasBuild: true,
        releasedVersion: '1.2.0',
      },
      mode,
    );

    expect(steps.build).toBeTrue();
  },
);
