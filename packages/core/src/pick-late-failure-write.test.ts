import { expect, test } from 'bun:test';
import { pickLateFailureWrite } from './pick-late-failure-write.ts';
import { WringerError } from './wringer-error.ts';

test('#pickLateFailureWrite writes nothing for work that succeeded', () => {
  expect(
    pickLateFailureWrite(
      { status: 'fulfilled', value: null },
      { runID: null, command: 'restock', answered: null, at: new Date('2026-11-05T09:00:00Z') },
    ),
  ).toBeNull();
});

test('#pickLateFailureWrite writes nothing for the failure the envelope answered with', () => {
  const answered = new WringerError('timeout');

  expect(
    pickLateFailureWrite(
      { status: 'rejected', reason: answered },
      { runID: null, command: 'restock', answered, at: new Date('2026-11-05T09:00:00Z') },
    ),
  ).toBeNull();
});

test('#pickLateFailureWrite writes nothing for work that hit the deadline the envelope answered', () => {
  expect(
    pickLateFailureWrite(
      { status: 'rejected', reason: new WringerError('timeout') },
      {
        runID: 'mf3k2a-7q1z',
        command: 'restock',
        answered: new WringerError('timeout'),
        at: new Date('2026-11-05T09:00:00Z'),
      },
    ),
  ).toBeNull();
});

test('#pickLateFailureWrite writes a late failure to the run that the command drove', () => {
  expect(
    pickLateFailureWrite(
      {
        status: 'rejected',
        reason: new WringerError('environment', { message: 'The shelf went away.' }),
      },
      {
        runID: 'mf3k2a-7q1z',
        command: 'restock',
        answered: new WringerError('timeout'),
        at: new Date('2026-11-05T09:00:00Z'),
      },
    ),
  ).toStrictEqual({
    runID: 'mf3k2a-7q1z',
    event: {
      type: 'late-failure',
      at: '2026-11-05T09:00:00.000Z',
      command: 'restock',
      code: 'environment',
      message: 'The shelf went away.',
    },
  });
});

test('#pickLateFailureWrite writes a thrown error with no run as an internal failure', () => {
  expect(
    pickLateFailureWrite(
      { status: 'rejected', reason: new Error('The recount lost its place.') },
      {
        runID: null,
        command: 'recount',
        answered: new WringerError('timeout'),
        at: new Date('2026-11-05T09:00:00Z'),
      },
    ),
  ).toStrictEqual({
    runID: null,
    event: {
      type: 'late-failure',
      at: '2026-11-05T09:00:00.000Z',
      command: 'recount',
      code: 'internal',
      message: 'wringer failed with an internal error: The recount lost its place.',
    },
  });
});
