import { expect, test } from 'bun:test';
import { getLockValue } from './get-lock-value.ts';

test('it returns the value of work that ran under the lock', () => {
  const value = getLockValue('/srv/shop/.wringer/locks/state.lock', {
    kind: 'ran',
    value: 'stocked',
  });

  expect(value).toBe('stocked');
});

test('it throws an environment error that names the lock another holder kept', () => {
  expect(() =>
    getLockValue('/srv/shop/.wringer/locks/state.lock', { kind: 'busy', holder: null }),
  ).toThrow(
    expect.objectContaining({
      code: 'environment',
      message: 'Another wringer command holds the lock /srv/shop/.wringer/locks/state.lock.',
    }),
  );
});
