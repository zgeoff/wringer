import { expect, test } from 'bun:test';
import { pickStopPlan } from './pick-stop-plan.ts';

test.each([
  {
    name: 'no run',
    input: { runID: undefined, status: undefined, reach: 'gone' },
    plan: { data: { run: null, stopped: false }, markCrashed: false, clearPointer: false },
  },
  {
    name: 'a run whose supervisor answered',
    input: { runID: 'mf3k2a-7q1z', status: 'running', reach: 'answered' },
    plan: { data: { run: 'mf3k2a-7q1z', stopped: true }, markCrashed: false, clearPointer: true },
  },
  {
    name: 'a running run whose supervisor is gone',
    input: { runID: 'mf3k2a-7q1z', status: 'running', reach: 'gone' },
    plan: { data: { run: 'mf3k2a-7q1z', stopped: false }, markCrashed: true, clearPointer: true },
  },
  {
    name: 'a starting run whose supervisor is gone',
    input: { runID: 'mf3k2a-7q1z', status: 'starting', reach: 'gone' },
    plan: { data: { run: 'mf3k2a-7q1z', stopped: false }, markCrashed: true, clearPointer: true },
  },
  {
    name: 'an ended run',
    input: { runID: 'mf3k2a-7q1z', status: 'ended', reach: 'gone' },
    plan: { data: { run: 'mf3k2a-7q1z', stopped: false }, markCrashed: false, clearPointer: true },
  },
  {
    name: 'a pointer to a run with no log',
    input: { runID: 'mf3k2a-7q1z', status: undefined, reach: 'gone' },
    plan: { data: { run: 'mf3k2a-7q1z', stopped: false }, markCrashed: false, clearPointer: true },
  },
] as const)('it plans the stop of $name', (row) => {
  expect(pickStopPlan(row.input)).toStrictEqual(row.plan);
});
