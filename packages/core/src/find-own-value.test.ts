import { expect, test } from 'bun:test';
import { findOwnValue } from './find-own-value.ts';

test.each([
  { key: 'pantry', found: 'run-7' },
  { key: 'cellar', found: undefined },
  { key: 'constructor', found: undefined },
  { key: 'toString', found: undefined },
  { key: '__proto__', found: undefined },
])('it finds $found for the key $key', (row) => {
  expect(findOwnValue({ pantry: 'run-7' }, row.key)).toBe(row.found);
});
