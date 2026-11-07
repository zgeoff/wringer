import { expect, test } from 'bun:test';
import { findCancelFailure } from './find-cancel-failure.ts';
import { WringerError } from './wringer-error.ts';

test.each([
  { name: 'no calls', settled: [], message: null },
  {
    name: 'a call that answered',
    settled: [{ status: 'fulfilled' as const, value: 3 }],
    message: null,
  },
  {
    name: 'a call that timed out',
    settled: [{ status: 'rejected' as const, reason: new WringerError('timeout') }],
    message: null,
  },
  {
    name: 'a call that timed out and one whose cancel failed',
    settled: [
      { status: 'rejected' as const, reason: new WringerError('timeout') },
      {
        status: 'rejected' as const,
        reason: new WringerError('environment', { message: 'The page did not close.' }),
      },
    ],
    message: 'The page did not close.',
  },
  {
    name: 'a call that threw something other than a wringer error',
    settled: [{ status: 'rejected' as const, reason: new Error('socket gone') }],
    message: null,
  },
])('it finds the cancel failure among $name', (row) => {
  expect(findCancelFailure(row.settled)?.message ?? null).toBe(row.message);
});
