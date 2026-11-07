import { expect, test } from 'bun:test';
import { raceDeadline } from './race-deadline.ts';

test('it returns the result of work that finishes before its deadline', () => {
  expect(raceDeadline(Promise.resolve('packed'), AbortSignal.timeout(5000))).resolves.toBe(
    'packed',
  );
});

test.each([
  { case: 'passes while the work runs', deadline: () => AbortSignal.timeout(20) },
  { case: 'passed before the race began', deadline: () => AbortSignal.abort() },
])('it times out work whose deadline $case', (row) => {
  const never = Promise.withResolvers<string>();

  expect(raceDeadline(never.promise, row.deadline())).rejects.toMatchObject({ code: 'timeout' });
});
