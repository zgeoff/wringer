import { expect, test } from 'bun:test';
import { pickDoctorOutcome } from './pick-doctor-outcome.ts';

test('it plans a passed event and passed data when every check passed', () => {
  const outcome = pickDoctorOutcome(
    [{ name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null }],
    '2026-11-05T08:00:00.000Z',
  );

  expect(outcome).toStrictEqual({
    event: {
      type: 'doctor-passed',
      at: '2026-11-05T08:00:00.000Z',
      results: [
        { name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null },
      ],
    },
    data: {
      passed: true,
      results: [
        { name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null },
      ],
    },
    failure: null,
  });
});

test('it plans a passed event, keeping each skipped check, when no check failed', () => {
  const outcome = pickDoctorOutcome(
    [
      { name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null },
      {
        name: 'stock',
        status: 'skipped',
        durationMs: 0,
        code: null,
        message: 'stock runs only on local.',
      },
    ],
    '2026-11-05T08:00:00.000Z',
  );

  expect({ type: outcome.event.type, data: outcome.data, failure: outcome.failure }).toStrictEqual({
    type: 'doctor-passed',
    data: {
      passed: true,
      results: [
        { name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null },
        {
          name: 'stock',
          status: 'skipped',
          durationMs: 0,
          code: null,
          message: 'stock runs only on local.',
        },
      ],
    },
    failure: null,
  });
});

test('it plans a failed event and a check-failed error that names each failed check', () => {
  const outcome = pickDoctorOutcome(
    [
      { name: 'http.health', status: 'passed', durationMs: 4, code: null, message: null },
      { name: 'db.connect', status: 'failed', durationMs: 9, code: 'environment', message: 'down' },
    ],
    '2026-11-05T08:00:00.000Z',
  );

  expect({ type: outcome.event.type, failure: outcome.failure }).toStrictEqual({
    type: 'doctor-failed',
    failure: expect.objectContaining({
      code: 'check-failed',
      message: 'The doctor failed: db.connect.',
    }),
  });
});
