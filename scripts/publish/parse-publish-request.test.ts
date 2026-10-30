import { expect, test } from 'bun:test';
import { parsePublishRequest } from './parse-publish-request.ts';

test('it reads an empty mode as a publish of the listed paths with their released versions', () => {
  const request = parsePublishRequest({
    modeText: '',
    pathsText: '["packages/kettle"]',
    releasedVersionsText: '{"packages/kettle":"1.2.0"}',
  });

  expect(request).toStrictEqual({
    kind: 'parsed',
    mode: 'publish',
    paths: { kind: 'listed', paths: ['packages/kettle'] },
    releasedVersions: { 'packages/kettle': '1.2.0' },
  });
});

test('it reads a publish with no paths as a publish of nothing', () => {
  const request = parsePublishRequest({
    modeText: 'publish',
    pathsText: '',
    releasedVersionsText: '',
  });

  expect(request).toStrictEqual({
    kind: 'parsed',
    mode: 'publish',
    paths: { kind: 'listed', paths: [] },
    releasedVersions: {},
  });
});

test('it reads a rehearsal with no paths as a rehearsal of every workspace package', () => {
  const request = parsePublishRequest({
    modeText: 'rehearse',
    pathsText: '[]',
    releasedVersionsText: '',
  });

  expect(request).toStrictEqual({
    kind: 'parsed',
    mode: 'rehearse',
    paths: { kind: 'workspace' },
    releasedVersions: {},
  });
});

test('it keeps the listed paths of a rehearsal that lists some', () => {
  const request = parsePublishRequest({
    modeText: 'rehearse',
    pathsText: '["packages/kettle"]',
    releasedVersionsText: '',
  });

  expect(request).toStrictEqual({
    kind: 'parsed',
    mode: 'rehearse',
    paths: { kind: 'listed', paths: ['packages/kettle'] },
    releasedVersions: {},
  });
});

test('it refuses a mode other than publish or rehearse', () => {
  const request = parsePublishRequest({
    modeText: 'dry-run',
    pathsText: '',
    releasedVersionsText: '',
  });

  expect(request).toStrictEqual({
    kind: 'refused',
    message: 'PUBLISH_MODE holds neither publish nor rehearse',
  });
});

test('it refuses paths that are not a JSON array', () => {
  const request = parsePublishRequest({
    modeText: 'publish',
    pathsText: 'packages/kettle',
    releasedVersionsText: '',
  });

  expect(request).toStrictEqual({
    kind: 'refused',
    message:
      'PATHS_RELEASED holds no JSON array of paths, or RELEASED_VERSIONS no JSON object of versions',
  });
});
