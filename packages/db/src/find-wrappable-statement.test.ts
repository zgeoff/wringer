import { expect, test } from 'bun:test';
import { findWrappableStatement } from './find-wrappable-statement.ts';

test.each([
  { sql: 'select id from orders', statement: 'select id from orders' },
  { sql: ' select id from orders ;\n', statement: 'select id from orders' },
  { sql: 'table orders', statement: 'table orders' },
  { sql: 'values (1), (2)', statement: 'values (1), (2)' },
  {
    sql: 'with open as (select 1) select * from open',
    statement: 'with open as (select 1) select * from open',
  },
  {
    sql: 'select id from orders -- the open ones',
    statement: 'select id from orders -- the open ones',
  },
  { sql: "select ';' as mark", statement: "select ';' as mark" },
  { sql: 'show statement_timeout', statement: null },
  { sql: 'explain select 1', statement: null },
  { sql: 'select 1; -- done', statement: 'select 1' },
  {
    sql: 'select id, text from notes where 1 = 0; /* done */ ;\n',
    statement: 'select id, text from notes where 1 = 0',
  },
  { sql: 'select 1 -- a;b\n', statement: 'select 1 -- a;b' },
  { sql: "select 'a;b'; -- done", statement: "select 'a;b'" },
  { sql: 'select 1; -- done\nselect 2', statement: null },
  { sql: 'select 1; select 2', statement: null },
  { sql: "select 'unclosed", statement: null },
] as const)('it finds $statement in `$sql`', (row) => {
  expect(findWrappableStatement(row.sql)).toBe(row.statement);
});
