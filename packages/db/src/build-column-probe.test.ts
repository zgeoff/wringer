import { expect, test } from 'bun:test';
import { buildColumnProbe } from './build-column-probe.ts';

test('it wraps a read that returned no rows in a probe of its columns', () => {
  const probe = buildColumnProbe('select id, text from notes where id = $1;', 0);

  expect(probe).toBe(
    'select to_json(r) as wringer_row from (select q.* from (values (1)) d(x) left join (\nselect id, text from notes where id = $1\n) q on true limit 1) r',
  );
});

test.each([
  { name: 'a read that returned rows', sql: 'select id from notes', rowCount: 2 },
  { name: 'a SHOW', sql: 'show statement_timeout', rowCount: 0 },
  { name: 'a read that ends in a comment after its `;`', sql: 'select 1; -- done', rowCount: 0 },
] as const)('it plans no probe for $name', (row) => {
  expect(buildColumnProbe(row.sql, row.rowCount)).toBeNull();
});
