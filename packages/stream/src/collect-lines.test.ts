import { expect, test } from 'bun:test';
import { collectLines } from './collect-lines.ts';

test.each([
  {
    name: 'whole lines',
    carry: '',
    text: 'one\ntwo\n',
    split: { lines: ['one', 'two'], carry: '' },
  },
  {
    name: 'an unfinished line',
    carry: '',
    text: 'one\ntw',
    split: { lines: ['one'], carry: 'tw' },
  },
  { name: 'a carried line', carry: 'tw', text: 'o\n', split: { lines: ['two'], carry: '' } },
  {
    name: 'a long unfinished line',
    carry: '',
    text: 'abcdefgh',
    split: { lines: [], carry: 'abcde' },
  },
])('it splits $name', (row) => {
  expect(collectLines(row.carry, row.text, 4)).toStrictEqual(row.split);
});
