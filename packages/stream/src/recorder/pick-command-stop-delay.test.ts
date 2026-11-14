import { expect, test } from 'bun:test';
import { pickCommandStopDelay } from './pick-command-stop-delay.ts';

test.each([
  {
    name: 'a command that printed nothing yet',
    facts: { nowMs: 1000, stopMs: 1000, lastLineMs: null },
    delayMs: 200,
  },
  {
    name: 'a command whose last line came before the stop',
    facts: { nowMs: 1000, stopMs: 1000, lastLineMs: 400 },
    delayMs: 200,
  },
  {
    name: 'a command that printed a line during the stop',
    facts: { nowMs: 1150, stopMs: 1000, lastLineMs: 1100 },
    delayMs: 150,
  },
  {
    name: 'a command quiet for the whole wait',
    facts: { nowMs: 1200, stopMs: 1000, lastLineMs: 900 },
    delayMs: 0,
  },
  {
    name: 'a command that never went quiet',
    facts: { nowMs: 2900, stopMs: 1000, lastLineMs: 2890 },
    delayMs: 100,
  },
  {
    name: 'a command past the stop limit',
    facts: { nowMs: 3000, stopMs: 1000, lastLineMs: 2990 },
    delayMs: 0,
  },
])('it picks the stop delay for $name', (row) => {
  expect(pickCommandStopDelay(row.facts)).toBe(row.delayMs);
});
