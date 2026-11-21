import { expect, test } from 'bun:test';
import { pickProbeStep } from './pick-probe-step.ts';

test.each([
  { method: 'HEAD', status: 200, expected: 'pass' },
  { method: 'HEAD', status: 302, expected: 'pass' },
  { method: 'HEAD', status: 403, expected: 'pass' },
  { method: 'HEAD', status: 404, expected: 'retry-get' },
  { method: 'HEAD', status: 405, expected: 'retry-get' },
  { method: 'HEAD', status: 501, expected: 'retry-get' },
  { method: 'HEAD', status: 500, expected: 'fail' },
  { method: 'HEAD', status: 503, expected: 'fail' },
  { method: 'GET', status: 200, expected: 'pass' },
  { method: 'GET', status: 404, expected: 'pass' },
  { method: 'GET', status: 501, expected: 'fail' },
  { method: 'GET', status: 500, expected: 'fail' },
] as const)('it picks $expected for $method answered with $status', (row) => {
  expect(pickProbeStep(row.method, row.status)).toBe(row.expected);
});
