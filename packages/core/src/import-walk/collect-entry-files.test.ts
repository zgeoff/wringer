import { expect, test } from 'bun:test';
import { collectEntryFiles } from './collect-entry-files.ts';

test.each([
  { entries: ['a/src/main.ts'], expected: ['a/src/main.ts'] },
  { entries: ['a/src'], expected: ['a/src/main.ts', 'a/src/util/x.ts'] },
  { entries: ['a/src/'], expected: ['a/src/main.ts', 'a/src/util/x.ts'] },
  { entries: ['*/src/main.ts'], expected: ['a/src/main.ts', 'b/src/main.ts'] },
  { entries: ['c'], expected: [] },
])('it collects $expected for the entries $entries', (row) => {
  const files = ['a/src/main.ts', 'a/src/util/x.ts', 'a/readme.md', 'b/src/main.ts'];

  expect(collectEntryFiles(files, row.entries)).toStrictEqual(row.expected);
});
