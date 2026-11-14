import { expect, test } from 'bun:test';
import { runIDSchema } from '../state/run-event.ts';
import { buildMockRunView } from '../test-utils/build-mock-run-view.ts';
import { pickEnvelopeRun } from './pick-envelope-run.ts';

test.each([
  {
    name: 'the run after the command',
    before: { targetName: 'local', run: undefined },
    settled: {
      targetName: 'local',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2a-7q1z') }),
    },
    runID: 'mf3k2a-7q1z',
  },
  {
    name: 'the run that the command ended',
    before: {
      targetName: 'local',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2a-7q1z') }),
    },
    settled: { targetName: 'local', run: undefined },
    runID: 'mf3k2a-7q1z',
  },
  {
    name: 'no run after a move to a target with none',
    before: {
      targetName: 'local',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2a-7q1z') }),
    },
    settled: { targetName: 'prod', run: undefined },
    runID: null,
  },
  {
    name: 'the run of the target the command moved to',
    before: {
      targetName: 'local',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2a-7q1z') }),
    },
    settled: {
      targetName: 'prod',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2b-8r2y'), target: 'prod' }),
    },
    runID: 'mf3k2b-8r2y',
  },
])('it picks $name', (row) => {
  const run = pickEnvelopeRun(row.before, row.settled, null);

  expect(run?.runID ?? null).toBe(row.runID);
});

test('it picks no run when no context could be read', () => {
  expect(pickEnvelopeRun(null, null, null)).toBeUndefined();
});

test('it picks the run a lifecycle command bound over the run the pointers name after it', () => {
  const run = pickEnvelopeRun(
    { targetName: 'local', run: undefined },
    {
      targetName: 'local',
      run: buildMockRunView({ runID: runIDSchema.parse('mf3k2b-8r2y') }),
    },
    buildMockRunView({ runID: runIDSchema.parse('mf3k2a-7q1z') }),
  );

  expect(run?.runID).toBe('mf3k2a-7q1z');
});
