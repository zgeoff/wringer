import { expect, test } from 'bun:test';
import { parseArgs } from 'gunshi';
import { findSignedValueFlag } from './find-signed-value-flag.ts';

test.each([
  { argv: ['tilt', '--degrees', '-15'], found: { flag: '--degrees', value: '-15' } },
  { argv: ['tilt', '--degrees', '-.25'], found: { flag: '--degrees', value: '-.25' } },
  { argv: ['tilt', '--degrees', '-7'], found: { flag: '--degrees', value: '-7' } },
  { argv: ['tilt', '--degrees=-15'], found: undefined },
  { argv: ['tilt', '--human', '-x'], found: undefined },
  { argv: ['lean', '--', '-15'], found: undefined },
])('it finds the flag that a negative value lost in $argv', (row) => {
  expect(findSignedValueFlag(parseArgs([...row.argv]), row.argv)).toStrictEqual(row.found);
});
