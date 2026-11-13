import { expect, test } from 'bun:test';
import { toSafeInteger } from './to-safe-integer.ts';

test.each([
  { name: 'zero', input: 0n, output: 0 },
  { name: 'a negative integer', input: -5n, output: -5 },
  {
    name: 'the largest safe integer',
    input: 9_007_199_254_740_991n,
    output: 9_007_199_254_740_991,
  },
  {
    name: 'the smallest safe integer',
    input: -9_007_199_254_740_991n,
    output: -9_007_199_254_740_991,
  },
  {
    name: 'the first integer above the safe range',
    input: 9_007_199_254_740_992n,
    output: '9007199254740992',
  },
  {
    name: 'an odd integer above the safe range',
    input: 9_007_199_254_740_993n,
    output: '9007199254740993',
  },
  {
    name: 'the first integer below the safe range',
    input: -9_007_199_254_740_992n,
    output: '-9007199254740992',
  },
  {
    name: 'the largest 64-bit integer',
    input: 9_223_372_036_854_775_807n,
    output: '9223372036854775807',
  },
])('it turns $name into $output', (row) => {
  expect(toSafeInteger(row.input)).toBe(row.output);
});
