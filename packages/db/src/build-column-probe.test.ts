import { expect, test } from 'bun:test';
import { buildColumnProbe } from './build-column-probe.ts';

test('it wraps a read that returned no rows in a probe of its columns', () => {
  const probe = buildColumnProbe('select id, text from notes where id = $1;', []);

  expect(probe).toBe(
    'select array(select key from json_object_keys(to_json(r)) with ordinality c(key, position) order by position) as wringer_columns from (select q.* from (values (1)) d(x) left join (\nselect id, text from notes where id = $1\n) q on true limit 1) r',
  );
});

test('it wraps a read that ends in a comment after its `;` without the comment', () => {
  const probe = buildColumnProbe('select id, text from notes where 1 = 0; -- done', []);

  expect(probe).toBe(
    'select array(select key from json_object_keys(to_json(r)) with ordinality c(key, position) order by position) as wringer_columns from (select q.* from (values (1)) d(x) left join (\nselect id, text from notes where 1 = 0\n) q on true limit 1) r',
  );
});

test('it wraps a read whose row has a column named like an array index', () => {
  const probe = buildColumnProbe('select 1 as "2", 2 as "1"', [{ 1: 2, 2: 1 }]);

  expect(probe).toBe(
    'select array(select key from json_object_keys(to_json(r)) with ordinality c(key, position) order by position) as wringer_columns from (select q.* from (values (1)) d(x) left join (\nselect 1 as "2", 2 as "1"\n) q on true limit 1) r',
  );
});

test.each([
  { name: 'a read that returned rows', sql: 'select id from notes', rows: [{ id: 1 }, { id: 2 }] },
  {
    name: 'a read with a column named like a negative number',
    sql: 'select 1 as "-1"',
    rows: [{ '-1': 1 }],
  },
  {
    name: 'a read with a column named like a padded number',
    sql: 'select 1 as "01"',
    rows: [{ '01': 1 }],
  },
  {
    name: 'a read with a column named past the last array index',
    sql: 'select 1 as "4294967295"',
    rows: [{ '4294967295': 1 }],
  },
  { name: 'a SHOW', sql: 'show statement_timeout', rows: [] },
])('it plans no probe for $name', (row) => {
  expect(buildColumnProbe(row.sql, row.rows)).toBeNull();
});
