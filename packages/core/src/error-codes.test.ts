import { expect, test } from 'bun:test';
import { errorCodes, exitCodeFor } from './error-codes.ts';

test('it closes the set of error codes', () => {
  expect(errorCodes).toStrictEqual([
    'check-failed',
    'usage',
    'read-only',
    'doctor-required',
    'not-running',
    'target-not-allowed',
    'environment',
    'internal',
    'timeout',
  ]);
});

test.each([
  ['check-failed', 1],
  ['usage', 2],
  ['read-only', 3],
  ['doctor-required', 3],
  ['not-running', 3],
  ['target-not-allowed', 3],
  ['environment', 4],
  ['internal', 4],
  ['timeout', 5],
] as const)('it maps the error code %s to exit code %d', (code, exitCode) => {
  expect(exitCodeFor[code]).toBe(exitCode);
});
