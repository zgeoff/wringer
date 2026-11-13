import { expect, test } from 'bun:test';
import { pickStatementTimeoutStep } from './pick-statement-timeout-step.ts';
import { collectStatementTimeoutSteps } from './test-utils/collect-statement-timeout-steps.ts';

test.each([
  {
    name: 'sets the time left before any timeout is set',
    previous: null,
    aborted: false,
    leftMs: 900.7,
    step: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
  },
  {
    name: 'runs once the timeout set is no longer than the time left',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
    aborted: false,
    leftMs: 900,
    step: { kind: 'run' },
  },
  {
    name: 'sets the time left less two round trips after a round trip of 1 ms',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
    aborted: false,
    leftMs: 899,
    step: { kind: 'set', timeoutMs: 897, leftMs: 899, sets: 2, slowestMs: 1 },
  },
  {
    name: 'sets the time left less two round trips after a round trip of 100 ms',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
    aborted: false,
    leftMs: 800,
    step: { kind: 'set', timeoutMs: 600, leftMs: 800, sets: 2, slowestMs: 100 },
  },
  {
    name: 'runs after a second round trip as slow as the first',
    previous: { kind: 'set', timeoutMs: 600, leftMs: 800, sets: 2, slowestMs: 100 },
    aborted: false,
    leftMs: 700,
    step: { kind: 'run' },
  },
  {
    name: 'expires when the third timeout set is still longer than the time left',
    previous: { kind: 'set', timeoutMs: 500, leftMs: 700, sets: 3, slowestMs: 100 },
    aborted: false,
    leftMs: 300,
    step: { kind: 'expired' },
  },
  {
    name: 'expires when two more round trips would pass the deadline',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
    aborted: false,
    leftMs: 600,
    step: { kind: 'expired' },
  },
  {
    name: 'expires with no whole millisecond left',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1, slowestMs: 0 },
    aborted: false,
    leftMs: 0.9,
    step: { kind: 'expired' },
  },
  {
    name: 'expires once the signal aborted',
    previous: null,
    aborted: true,
    leftMs: 900,
    step: { kind: 'expired' },
  },
  {
    name: 'sets one last timeout from the slowest round trip after jittery round trips use up the sets',
    previous: { kind: 'set', timeoutMs: 29_840, leftMs: 29_940, sets: 3, slowestMs: 50 },
    aborted: false,
    leftMs: 29_820,
    step: { kind: 'set', timeoutMs: 29_580, leftMs: 29_820, sets: 4, slowestMs: 120 },
  },
  {
    name: 'sets the last timeout when the slowest round trip is a small share of the time left',
    previous: { kind: 'set', timeoutMs: 9840, leftMs: 9940, sets: 3, slowestMs: 50 },
    aborted: false,
    leftMs: 9820,
    step: { kind: 'set', timeoutMs: 9580, leftMs: 9820, sets: 4, slowestMs: 120 },
  },
  {
    name: 'expires when the slowest round trip is a large share of the time left',
    previous: { kind: 'set', timeoutMs: 840, leftMs: 940, sets: 3, slowestMs: 50 },
    aborted: false,
    leftMs: 790,
    step: { kind: 'expired' },
  },
  {
    name: 'expires after the last timeout when a round trip passes the time it left',
    previous: { kind: 'set', timeoutMs: 29_580, leftMs: 29_820, sets: 4, slowestMs: 120 },
    aborted: false,
    leftMs: 29_000,
    step: { kind: 'expired' },
  },
] as const)('#pickStatementTimeoutStep $name', (row) => {
  expect(pickStatementTimeoutStep(row.previous, row.aborted, row.leftMs)).toStrictEqual(row.step);
});

test('#pickStatementTimeoutStep sets one last timeout from the slowest round trip when jittery round trips use up the checks', () => {
  const steps = collectStatementTimeoutSteps(30_000, [10, 50, 120, 20]);

  expect(steps.map((step) => step.kind)).toStrictEqual(['set', 'set', 'set', 'set', 'run']);

  expect(steps[3]).toStrictEqual({
    kind: 'set',
    timeoutMs: 29_580,
    leftMs: 29_820,
    sets: 4,
    slowestMs: 120,
  });
});
