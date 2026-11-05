import { expect, test } from 'bun:test';
import { buildMockEnvelope } from '../test-utils/build-mock-envelope.ts';
import { buildMockRunView } from '../test-utils/build-mock-run-view.ts';
import { pickLogRefusal } from './pick-log-refusal.ts';
import { WringerError } from './wringer-error.ts';

test.each([
  { name: 'a drive', envelope: buildMockEnvelope({ command: 'notes add' }) },
  {
    name: 'a failed done',
    envelope: buildMockEnvelope({
      command: 'done',
      ok: false,
      error: { code: 'doctor-required', message: 'Run doctor.', hint: null },
    }),
  },
])('it checks nothing under the lock for $name', (row) => {
  expect(pickLogRefusal(row.envelope, buildMockRunView({ doctor: 'passed' }))).toBeNull();
});

test('it refuses the verdict of a done whose doctor failed by the time its log is written', () => {
  const refuse = pickLogRefusal(
    buildMockEnvelope({ command: 'done' }),
    buildMockRunView({ doctor: 'passed', drivesAfterDoctor: [] }),
  );

  const refusal = refuse?.(buildMockRunView({ doctor: 'failed', drivesAfterDoctor: [] }));

  expect(refusal).toBeInstanceOf(WringerError);
});
