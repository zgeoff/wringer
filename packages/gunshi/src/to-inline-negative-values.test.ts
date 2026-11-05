import { expect, test } from 'bun:test';
import { toInlineNegativeValues } from './to-inline-negative-values.ts';

test.each([
  { argv: ['restock', '--count', '-1'], joined: ['restock', '--count=-1'] },
  { argv: ['restock', '--ratio', '-.5'], joined: ['restock', '--ratio=-.5'] },
  {
    argv: ['restock', '--count', '-1', '--count', '-20'],
    joined: ['restock', '--count=-1', '--count=-20'],
  },
  { argv: ['restock', '--count=-1'], joined: ['restock', '--count=-1'] },
  { argv: ['restock', '--count', '3'], joined: ['restock', '--count', '3'] },
  { argv: ['restock', '--label', '-v'], joined: ['restock', '--label', '-v'] },
  { argv: ['restock', '--', '--count', '-1'], joined: ['restock', '--', '--count', '-1'] },
  { argv: ['restock', '--count', '--', '-1'], joined: ['restock', '--count', '--', '-1'] },
  { argv: ['restock', '-1'], joined: ['restock', '-1'] },
])('it turns $argv into $joined', (row) => {
  expect(toInlineNegativeValues(row.argv)).toStrictEqual([...row.joined]);
});
