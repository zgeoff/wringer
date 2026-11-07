import { expect, test } from 'bun:test';
import { WringerError } from './wringer-error.ts';

test('it gives an error without a message the default message of its code', () => {
  const error = new WringerError('not-running');

  expect({ message: error.message, hint: error.hint, data: error.data }).toStrictEqual({
    message: 'The target has no running run.',
    hint: undefined,
    data: undefined,
  });
});

test('it keeps the message, hint and data it is given', () => {
  const error = new WringerError('read-only', {
    message: 'POST /orders is a write.',
    hint: 'Reproduce it on staging.',
    data: { method: 'POST' },
  });

  expect({
    code: error.code,
    message: error.message,
    hint: error.hint,
    data: error.data,
  }).toStrictEqual({
    code: 'read-only',
    message: 'POST /orders is a write.',
    hint: 'Reproduce it on staging.',
    data: { method: 'POST' },
  });
});
