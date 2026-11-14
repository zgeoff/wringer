import { expect, test } from 'bun:test';
import { pickCancelStep } from './pick-cancel-step.ts';

test.each([
  {
    name: 'a first tick before the query settles',
    state: { open: false, failing: false },
    event: { kind: 'tick', settled: false },
    step: { state: { open: true, failing: false }, effects: [{ kind: 'attempt' }] },
  },
  {
    name: 'a tick once the query settled with no session open',
    state: { open: false, failing: false },
    event: { kind: 'tick', settled: true },
    step: { state: { open: false, failing: false }, effects: [{ kind: 'stop' }] },
  },
  {
    name: 'a tick once the query settled with a session open',
    state: { open: true, failing: false },
    event: { kind: 'tick', settled: true },
    step: {
      state: { open: false, failing: false },
      effects: [{ kind: 'close' }, { kind: 'stop' }],
    },
  },
  {
    name: 'a cancel that went through after failures',
    state: { open: true, failing: true },
    event: { kind: 'cancelled' },
    step: { state: { open: true, failing: false }, effects: [{ kind: 'wait' }] },
  },
  {
    name: 'a first failed cancel',
    state: { open: true, failing: false },
    event: { kind: 'failed', message: 'connection refused' },
    step: {
      state: { open: false, failing: true },
      effects: [
        {
          kind: 'report',
          message:
            'The query could not be cancelled yet, and runs on until it can be: connection refused',
        },
        { kind: 'close' },
        { kind: 'wait' },
      ],
    },
  },
  {
    name: 'a failed cancel after another failure',
    state: { open: true, failing: true },
    event: { kind: 'failed', message: 'connection refused' },
    step: { state: { open: false, failing: true }, effects: [{ kind: 'close' }, { kind: 'wait' }] },
  },
] as const)('it picks the next step for $name', (row) => {
  expect(pickCancelStep(row.state, row.event)).toStrictEqual(row.step);
});
