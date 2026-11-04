import { expect, test } from 'bun:test';
import { pickEnvelopePayload } from './pick-envelope-payload.ts';
import { WringerError } from './wringer-error.ts';

test('it keeps the data and cursors of a command that worked', () => {
  const payload = pickEnvelopePayload({
    data: { notes: 2 },
    commandFailure: null,
    cursors: { app: 120 },
  });

  expect(payload).toStrictEqual({ data: { notes: 2 }, failure: null, cursors: { app: 120 } });
});

test('it carries the data that a failed command’s error gives', () => {
  const failure = new WringerError('check-failed', { data: { failing: ['checkout'] } });

  const payload = pickEnvelopePayload({ data: { notes: 2 }, commandFailure: failure, cursors: {} });

  expect(payload).toStrictEqual({ data: { failing: ['checkout'] }, failure, cursors: {} });
});

test('it keeps the stack of an internal error out of the envelope data', () => {
  const failure = new WringerError('internal', { data: { stack: 'Error: boom' } });

  const payload = pickEnvelopePayload({ data: null, commandFailure: failure, cursors: {} });

  expect(payload.data).toBeNull();
});

test('it fails a command that worked with the cursor read that failed after it', () => {
  const cursorsFailure = new WringerError('environment', {
    message: 'The streams are unreadable.',
  });

  const payload = pickEnvelopePayload({
    data: { notes: 2 },
    commandFailure: null,
    cursors: cursorsFailure,
  });

  expect(payload).toStrictEqual({ data: undefined, failure: cursorsFailure, cursors: {} });
});

test('it keeps the command’s own failure ahead of a cursor read that failed', () => {
  const commandFailure = new WringerError('timeout');

  const payload = pickEnvelopePayload({
    data: null,
    commandFailure,
    cursors: new WringerError('environment'),
  });

  expect(payload.failure).toBe(commandFailure);
});
