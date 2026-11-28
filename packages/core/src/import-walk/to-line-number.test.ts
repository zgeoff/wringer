import { expect, test } from 'bun:test';
import { toLineNumber } from './to-line-number.ts';

test.each([
  { source: 'a\nb\nc', offset: 0, line: 1 },
  { source: 'a\nb\nc', offset: 2, line: 2 },
  { source: 'a\nb\nc', offset: 4, line: 3 },
  { source: 'a\nb', offset: 99, line: 2 },
])('it reads line $line for offset $offset', (row) => {
  expect(toLineNumber(row.source, row.offset)).toBe(row.line);
});
