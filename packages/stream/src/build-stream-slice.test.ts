import { expect, test } from 'bun:test';
import { buildStreamSlice } from './build-stream-slice.ts';

test.each([
  {
    bytes: 'whole records that reach the end of the file',
    text: '{"at":"t1","line":"up"}\n{"at":"t2","line":"ready"}\n',
    from: 0,
    size: 51,
    slice: {
      records: [
        { at: 't1', line: 'up' },
        { at: 't2', line: 'ready' },
      ],
      cursor: 51,
      more: false,
    },
  },
  {
    bytes: 'a read that stopped inside its second record',
    text: '{"at":"t1","line":"up"}\n{"at":"t2","li',
    from: 100,
    size: 400,
    slice: { records: [{ at: 't1', line: 'up' }], cursor: 124, more: true },
  },
  {
    bytes: 'nothing',
    text: '',
    from: 30,
    size: 30,
    slice: { records: [], cursor: 30, more: false },
  },
])('it builds the slice of $bytes', (row) => {
  expect(buildStreamSlice(Buffer.from(row.text), row.from, row.size)).toStrictEqual(row.slice);
});
