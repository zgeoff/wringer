import { expect, test } from 'bun:test';
import { parseArgs } from 'gunshi';
import { collectBooleanFlagsWithValue } from './collect-boolean-flags-with-value.ts';

test.each([
  { argv: ['restock', '--dry-run=false'], flags: ['--dry-run'] },
  { argv: ['restock', '--dry-run=maybe'], flags: ['--dry-run'] },
  { argv: ['restock', '--no-dry-run=true'], flags: ['--no-dry-run'] },
  { argv: ['restock', '--dry-run'], flags: [] },
  { argv: ['restock', '--no-dry-run'], flags: [] },
  { argv: ['restock', '--dry-run', 'false'], flags: [] },
  { argv: ['restock', '--shelf=aisle-4'], flags: [] },
])('it names $flags as the boolean flags given a value in $argv', (row) => {
  const flags = collectBooleanFlagsWithValue(parseArgs([...row.argv]), {
    dryRun: { type: 'boolean', negatable: true },
    shelf: { type: 'string' },
  });

  expect(flags).toStrictEqual(row.flags);
});
