import { expect, test } from 'bun:test';
import { toBareSQL } from './to-bare-sql.ts';

test.each([
  { sql: "select 'vacuum' as label", bare: 'select   as label' },
  { sql: "select 'it''s' from notes", bare: 'select   from notes' },
  { sql: 'select "attach" from [query_only]', bare: 'select   from  ' },
  { sql: 'select `vacuum` from notes', bare: 'select   from notes' },
  { sql: 'select 1 -- vacuum\nfrom notes', bare: 'select 1  \nfrom notes' },
  { sql: "select /* 'attach */ 1", bare: 'select   1' },
  { sql: "select '-- not a comment' , 2", bare: 'select   , 2' },
  { sql: "vacuum into '/srv/copy.db'", bare: 'vacuum into  ' },
  { sql: "select 'unclosed vacuum", bare: "select 'unclosed vacuum" },
])('it reads `$sql` as `$bare`', (row) => {
  expect(toBareSQL(row.sql)).toBe(row.bare);
});
