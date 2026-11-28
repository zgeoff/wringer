import { expect, test } from 'bun:test';
import { parseStatusPaths } from './parse-status-paths.ts';

test.each([
  { name: 'modified and untracked', output: ' M a.ts\0?? b.ts\0', expected: ['a.ts', 'b.ts'] },
  {
    name: 'renamed, with the old path',
    output: 'R  new.ts\0old.ts\0 M c.ts\0',
    expected: ['c.ts', 'new.ts', 'old.ts'],
  },
  { name: 'clean', output: '', expected: [] },
])('it parses $name', (row) => {
  expect(parseStatusPaths(Buffer.from(row.output))).toStrictEqual(row.expected);
});
