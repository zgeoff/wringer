import { expect, test } from 'bun:test';
import { findCancelFailure } from './find-cancel-failure.ts';
import { WringerError } from './wringer-error.ts';

test.each([
  { name: 'no failures', failures: [], message: null },
  { name: 'a timeout', failures: [new WringerError('timeout')], message: null },
  {
    name: 'a timeout and a cancel that failed',
    failures: [
      new WringerError('timeout'),
      new WringerError('environment', { message: 'The page did not close.' }),
    ],
    message: 'The page did not close.',
  },
])('it finds the cancel failure among $name', (row) => {
  expect(findCancelFailure(row.failures)?.message ?? null).toBe(row.message);
});
