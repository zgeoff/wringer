import { expect, test } from 'bun:test';
import { pickEnvelopeContext } from './pick-envelope-context.ts';

test.each([
  { keepsStart: true, picked: 'checked-run' },
  { keepsStart: false, picked: 'restarted-run' },
])('it picks the $picked context for a command that keeps its start: $keepsStart', (row) => {
  expect(
    pickEnvelopeContext({ run: 'checked-run' }, { run: 'restarted-run' }, row.keepsStart),
  ).toStrictEqual({ run: row.picked });
});
