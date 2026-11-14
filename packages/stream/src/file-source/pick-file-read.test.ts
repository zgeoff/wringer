import { expect, test } from 'bun:test';
import { pickFileRead } from './pick-file-read.ts';

test.each([
  {
    file: 'a file that grew',
    facts: { size: 900, identity: '64:12' },
    from: { offset: 300, identity: '64:12' },
    read: { start: 300, length: 600 },
  },
  {
    file: 'a file read for the first time',
    facts: { size: 900, identity: '64:12' },
    from: { offset: 0, identity: null },
    read: { start: 0, length: 900 },
  },
  {
    file: 'a file that shrank below the offset',
    facts: { size: 100, identity: '64:12' },
    from: { offset: 300, identity: '64:12' },
    read: { start: 0, length: 100 },
  },
  {
    file: 'a new file at the path',
    facts: { size: 500, identity: '64:13' },
    from: { offset: 300, identity: '64:12' },
    read: { start: 0, length: 500 },
  },
  {
    file: 'a file with more to read than the limit',
    facts: { size: 200_000, identity: '64:12' },
    from: { offset: 1000, identity: '64:12' },
    read: { start: 1000, length: 65_536 },
  },
])('it picks the read of $file', (row) => {
  expect(pickFileRead(row.facts, row.from, 65_536)).toStrictEqual(row.read);
});
