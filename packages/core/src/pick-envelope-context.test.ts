import { expect, test } from 'bun:test';
import { pickEnvelopeContext } from './pick-envelope-context.ts';

test.each([
  { ranOnRun: true, picked: 'checked-run' },
  { ranOnRun: false, picked: 'restarted-run' },
])('it picks the $picked context for a command that ran on a run: $ranOnRun', (row) => {
  expect(
    pickEnvelopeContext({ run: 'checked-run' }, { run: 'restarted-run' }, row.ranOnRun),
  ).toStrictEqual({ run: row.picked });
});
