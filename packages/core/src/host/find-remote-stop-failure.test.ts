import { expect, test } from 'bun:test';
import { WringerError } from '../wringer-error.ts';
import { findRemoteStopFailure } from './find-remote-stop-failure.ts';

test.each([
  { name: 'no stops', stops: [], failure: null },
  {
    name: 'a stop that worked',
    stops: [{ status: 'fulfilled', value: { exitCode: 0, stdout: '', stderr: '' } }] as const,
    failure: null,
  },
  {
    name: 'a stop that exited 255',
    stops: [
      {
        status: 'fulfilled',
        value: { exitCode: 255, stdout: '', stderr: 'Connection timed out\n' },
      },
    ] as const,
    failure: 'the stop exited with code 255: Connection timed out',
  },
  {
    name: 'a stop that never ran',
    stops: [
      {
        status: 'rejected',
        reason: new WringerError('timeout', { message: 'The stop ran past 10000 ms.' }),
      },
    ] as const,
    failure: 'The stop ran past 10000 ms.',
  },
])('it names the failure of $name', (row) => {
  expect(findRemoteStopFailure(row.stops)).toBe(row.failure);
});
