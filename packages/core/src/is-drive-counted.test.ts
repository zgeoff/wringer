import { expect, test } from 'bun:test';
import { isDriveCounted } from './is-drive-counted.ts';
import { buildMockRunView } from './test-utils/build-mock-run-view.ts';

test.each([
  { reason: 'app', expected: true },
  { reason: 'none', expected: false },
] as const)('it answers $expected for a $reason drive whatever changed', (row) => {
  const started = {
    targetName: 'local',
    run: buildMockRunView({ runID: 'mf3k2a-0001' }),
    feature: 'search',
  };

  const current = {
    pointers: { currentRun: { local: 'mf3k2a-0002' }, feature: 'checkout', cursors: {} },
    sessionFeature: undefined,
  };

  expect(isDriveCounted(row.reason, started, current)).toBe(row.expected);
});

test.each([
  {
    source: 'the saved feature',
    pointerFeature: 'search',
    sessionFeature: undefined,
  },
  {
    source: 'the feature the command passed, whatever the saved one',
    pointerFeature: 'checkout',
    sessionFeature: 'search',
  },
])('it counts a feature command whose run and feature are still current, from $source', (row) => {
  const started = {
    targetName: 'local',
    run: buildMockRunView({ runID: 'mf3k2a-0001' }),
    feature: 'search',
  };

  const current = {
    pointers: { currentRun: { local: 'mf3k2a-0001' }, feature: row.pointerFeature, cursors: {} },
    sessionFeature: row.sessionFeature,
  };

  expect(isDriveCounted('feature-command', started, current)).toBeTrue();
});

test.each([
  {
    change: 'the current feature moved',
    started: {
      targetName: 'local',
      run: buildMockRunView({ runID: 'mf3k2a-0001' }),
      feature: 'search',
    },
    currentRun: { local: 'mf3k2a-0001' },
    feature: 'checkout',
  },
  {
    change: 'the current feature was cleared',
    started: {
      targetName: 'local',
      run: buildMockRunView({ runID: 'mf3k2a-0001' }),
      feature: 'search',
    },
    currentRun: { local: 'mf3k2a-0001' },
    feature: undefined,
  },
  {
    change: 'another run became current',
    started: {
      targetName: 'local',
      run: buildMockRunView({ runID: 'mf3k2a-0001' }),
      feature: 'search',
    },
    currentRun: { local: 'mf3k2a-0002' },
    feature: 'search',
  },
  {
    change: 'the run stopped',
    started: {
      targetName: 'local',
      run: buildMockRunView({ runID: 'mf3k2a-0001' }),
      feature: 'search',
    },
    currentRun: {},
    feature: 'search',
  },
  {
    change: 'the doctor had not passed when it started',
    started: {
      targetName: 'local',
      run: buildMockRunView({ runID: 'mf3k2a-0001', doctor: 'none' }),
      feature: 'search',
    },
    currentRun: { local: 'mf3k2a-0001' },
    feature: 'search',
  },
  {
    change: 'no run was current',
    started: { targetName: 'local', run: undefined, feature: 'search' },
    currentRun: {},
    feature: 'search',
  },
])('it does not count a feature command when $change', (row) => {
  const current = {
    pointers: { currentRun: row.currentRun, feature: row.feature, cursors: {} },
    sessionFeature: undefined,
  };

  expect(isDriveCounted('feature-command', row.started, current)).toBeFalse();
});
