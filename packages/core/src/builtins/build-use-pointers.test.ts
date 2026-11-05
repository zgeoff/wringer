import { expect, test } from 'bun:test';
import { buildUsePointers } from './build-use-pointers.ts';

test.each([
  {
    change: 'a new feature, keeping the saved target',
    current: { currentRun: { local: 'mf3k2a-7q1z' }, target: 'local', cursors: { app: 4 } },
    use: { target: undefined, feature: 'checkout', cursors: { app: 120 }, runID: 'mf3k2a-7q1z' },
    pointers: {
      currentRun: { local: 'mf3k2a-7q1z' },
      target: 'local',
      feature: 'checkout',
      cursors: { app: 120 },
      cursorsRun: 'mf3k2a-7q1z',
    },
  },
  {
    change: 'a target with no run, dropping the old cursors',
    current: {
      currentRun: { local: 'mf3k2a-7q1z' },
      target: 'local',
      feature: 'checkout',
      cursors: { app: 120 },
      cursorsRun: 'mf3k2a-7q1z',
    },
    use: { target: 'prod', feature: undefined, cursors: {}, runID: undefined },
    pointers: {
      currentRun: { local: 'mf3k2a-7q1z' },
      target: 'prod',
      feature: 'checkout',
      cursors: {},
    },
  },
  {
    change: 'nothing on empty pointers',
    current: { currentRun: {}, cursors: {} },
    use: { target: undefined, feature: undefined, cursors: {}, runID: undefined },
    pointers: { currentRun: {}, cursors: {} },
  },
])('it builds the pointers for $change', (row) => {
  expect(buildUsePointers(row.current, row.use)).toStrictEqual(row.pointers);
});
