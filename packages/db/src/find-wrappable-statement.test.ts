import { expect, test } from 'bun:test';
import { findWrappableStatement } from './find-wrappable-statement.ts';

test.each([
  { dialect: 'postgres', sql: 'select id from orders', statement: 'select id from orders' },
  { dialect: 'postgres', sql: ' select id from orders ;\n', statement: 'select id from orders' },
  { dialect: 'postgres', sql: 'table orders', statement: 'table orders' },
  { dialect: 'postgres', sql: 'values (1), (2)', statement: 'values (1), (2)' },
  {
    dialect: 'postgres',
    sql: 'with open as (select 1) select * from open',
    statement: 'with open as (select 1) select * from open',
  },
  {
    dialect: 'postgres',
    sql: 'select id from orders -- the open ones',
    statement: 'select id from orders -- the open ones',
  },
  { dialect: 'postgres', sql: "select ';' as mark", statement: "select ';' as mark" },
  { dialect: 'postgres', sql: 'show statement_timeout', statement: null },
  { dialect: 'postgres', sql: 'explain select 1', statement: null },
  { dialect: 'postgres', sql: 'select 1; -- done', statement: null },
  { dialect: 'postgres', sql: 'select 1; select 2', statement: null },
  { dialect: 'postgres', sql: "select 'unclosed", statement: null },
  { dialect: 'sqlite', sql: 'select text from notes;', statement: 'select text from notes' },
  { dialect: 'sqlite', sql: 'table notes', statement: null },
  { dialect: 'sqlite', sql: 'pragma table_info(notes)', statement: null },
] as const)('it finds $statement in `$sql` on $dialect', (row) => {
  expect(findWrappableStatement(row.dialect, row.sql)).toBe(row.statement);
});
