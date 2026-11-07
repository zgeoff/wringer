import { expect, test } from 'bun:test';
import { pickStatementTimeoutStep } from './pick-statement-timeout-step.ts';

test.each([
  {
    name: 'sets the time left before any timeout is set',
    previous: null,
    aborted: false,
    leftMs: 900.7,
    step: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
  },
  {
    name: 'runs once the timeout set is no longer than the time left',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 900,
    step: { kind: 'run' },
  },
  {
    name: 'sets the time left less two round trips after a round trip of 1 ms',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 899,
    step: { kind: 'set', timeoutMs: 897, leftMs: 899, sets: 2 },
  },
  {
    name: 'sets the time left less two round trips after a round trip of 100 ms',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 800,
    step: { kind: 'set', timeoutMs: 600, leftMs: 800, sets: 2 },
  },
  {
    name: 'runs after a second round trip as slow as the first',
    previous: { kind: 'set', timeoutMs: 600, leftMs: 800, sets: 2 },
    aborted: false,
    leftMs: 700,
    step: { kind: 'run' },
  },
  {
    name: 'expires when the third timeout set is still longer than the time left',
    previous: { kind: 'set', timeoutMs: 500, leftMs: 700, sets: 3 },
    aborted: false,
    leftMs: 300,
    step: { kind: 'expired' },
  },
  {
    name: 'expires when two more round trips would pass the deadline',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 600,
    step: { kind: 'expired' },
  },
  {
    name: 'expires with no whole millisecond left',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
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
] as const)('#pickStatementTimeoutStep $name', (row) => {
  expect(pickStatementTimeoutStep(row.previous, row.aborted, row.leftMs)).toStrictEqual(row.step);
});
