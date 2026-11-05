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
    name: 'runs once the timeout set matches the time left',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 900,
    step: { kind: 'run' },
  },
  {
    name: 'runs when the round trip took no more than the slack',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 850,
    step: { kind: 'run' },
  },
  {
    name: 'sets the time left less one round trip when the round trip took longer',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 800,
    step: { kind: 'set', timeoutMs: 700, leftMs: 800, sets: 2 },
  },
  {
    name: 'runs after a second round trip as slow as the first',
    previous: { kind: 'set', timeoutMs: 700, leftMs: 800, sets: 2 },
    aborted: false,
    leftMs: 700,
    step: { kind: 'run' },
  },
  {
    name: 'runs with the last timeout once the third one is set',
    previous: { kind: 'set', timeoutMs: 500, leftMs: 700, sets: 3 },
    aborted: false,
    leftMs: 300,
    step: { kind: 'run' },
  },
  {
    name: 'expires when one more round trip would pass the deadline',
    previous: { kind: 'set', timeoutMs: 900, leftMs: 900, sets: 1 },
    aborted: false,
    leftMs: 400,
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
