import { expect, test } from 'bun:test';
import { buildManifestWrite } from './build-manifest-write.ts';
import { buildRunView } from './build-run-view.ts';
import { runIDSchema } from './run-events.ts';

test('it plans no manifest for a run that has no log yet', () => {
  const plan = buildManifestWrite('/srv/shop/.wringer/runs/mf3k2a-7q1z/manifest.json', undefined);

  expect(plan).toBeNull();
});

test('it plans the manifest of a run as indented JSON at the path it is given', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
    ],
  });

  const plan = buildManifestWrite('/srv/shop/.wringer/runs/mf3k2a-7q1z/manifest.json', view);

  expect(plan).toStrictEqual({
    path: '/srv/shop/.wringer/runs/mf3k2a-7q1z/manifest.json',
    text: `${JSON.stringify(
      {
        target: 'local',
        instance: 'mf3k2a-7q1z',
        mode: 'launch',
        fingerprint: 'f00d',
        status: 'starting',
        doctor: { state: 'none', results: [] },
        startedAt: '2026-11-04T10:00:00.000Z',
        endedAt: null,
      },
      null,
      2,
    )}\n`,
  });
});
