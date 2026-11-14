import { expect, test } from 'bun:test';
import { buildMockEnvelope } from '../test-utils/build-mock-envelope.ts';
import { buildMockRunView } from '../test-utils/build-mock-run-view.ts';
import { findVerdictRefusal } from './find-verdict-refusal.ts';

test.each([
  {
    name: 'leaves a verdict whose drives still open the run after more drives',
    current: buildMockRunView({
      doctor: 'passed',
      drivesAfterDoctor: [
        buildMockEnvelope({ command: 'action receipt' }),
        buildMockEnvelope({ command: 'notes add' }),
      ],
    }),
    code: null,
  },
  {
    name: 'refuses a verdict once the doctor failed',
    current: buildMockRunView({ doctor: 'failed', drivesAfterDoctor: [] }),
    code: 'doctor-required',
  },
  {
    name: 'refuses a verdict once the doctor passed again and a new drive ran',
    current: buildMockRunView({
      doctor: 'passed',
      drivesAfterDoctor: [buildMockEnvelope({ command: 'notes add' })],
    }),
    code: 'doctor-required',
  },
  {
    name: 'refuses a verdict for a run whose log has no start',
    current: undefined,
    code: 'doctor-required',
  },
])('#findVerdictRefusal $name', (row) => {
  const read = buildMockRunView({
    doctor: 'passed',
    drivesAfterDoctor: [buildMockEnvelope({ command: 'action receipt' })],
  });

  expect(findVerdictRefusal(read, row.current)?.code ?? null).toBe(row.code);
});
