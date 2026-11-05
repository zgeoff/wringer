import { expect, test } from 'bun:test';
import { pickStatementTimeoutStep } from './pick-statement-timeout-step.ts';

test.each([
  {
    name: 'sets the time left before any timeout is set',
    setMs: null,
    aborted: false,
    leftMs: 900.7,
    step: { kind: 'set', timeoutMs: 900 },
  },
  {
    name: 'runs once the timeout set matches the time left',
    setMs: 900,
    aborted: false,
    leftMs: 900,
    step: { kind: 'run' },
  },
  {
    name: 'runs when the round trip took no more than the slack',
    setMs: 900,
    aborted: false,
    leftMs: 850,
    step: { kind: 'run' },
  },
  {
    name: 'sets the time left again when the round trip took longer',
    setMs: 900,
    aborted: false,
    leftMs: 849,
    step: { kind: 'set', timeoutMs: 849 },
  },
  {
    name: 'expires with no whole millisecond left',
    setMs: 900,
    aborted: false,
    leftMs: 0.9,
    step: { kind: 'expired' },
  },
  {
    name: 'expires once the signal aborted',
    setMs: null,
    aborted: true,
    leftMs: 900,
    step: { kind: 'expired' },
  },
] as const)('#pickStatementTimeoutStep $name', (row) => {
  expect(pickStatementTimeoutStep(row.setMs, row.aborted, row.leftMs)).toStrictEqual(row.step);
});
