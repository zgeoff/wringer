import { expect, test } from 'bun:test';
import { keepFlagText } from './keep-flag-text.ts';

test.each([
  ['an empty value', ''],
  ['a value with spaces', ' shelf a '],
])('it keeps %s as typed', (_name, value) => {
  expect(keepFlagText(value)).toBe(value);
});
