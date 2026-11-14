import { expect, test } from 'bun:test';
import { parseArgs } from 'gunshi';
import { collectFlagsWithoutValue } from './collect-flags-without-value.ts';

test.each([
  { argv: ['label', 'shelf-a', '--label'], flags: ['--label'] },
  { argv: ['label', '--label', '--loud'], flags: ['--label'] },
  { argv: ['label', '--label', '--', 'pear'], flags: ['--label'] },
  { argv: ['label', '--timeout-ms'], flags: ['--timeout-ms'] },
  { argv: ['label', '--label', ''], flags: [] },
  { argv: ['label', '--label='], flags: [] },
  { argv: ['label', '--label', 'ripe'], flags: [] },
  { argv: ['label', '--loud'], flags: [] },
  { argv: ['label', '--no-loud'], flags: [] },
])('it names $flags as the value flags with no value in $argv', (row) => {
  const flags = collectFlagsWithoutValue(parseArgs([...row.argv]), {
    label: { type: 'string' },
    timeoutMs: { type: 'number' },
    loud: { type: 'boolean', negatable: true },
  });

  expect(flags).toStrictEqual(row.flags);
});
