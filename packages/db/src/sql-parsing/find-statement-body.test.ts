import { expect, test } from 'bun:test';
import { findStatementBody } from './find-statement-body.ts';

test.each([
  { dialect: 'postgres', sql: ' select id from orders \n', body: 'select id from orders' },
  { dialect: 'postgres', sql: 'select 1; -- done', body: 'select 1' },
  { dialect: 'postgres', sql: 'select 1; /* done */ ;\n', body: 'select 1' },
  { dialect: 'postgres', sql: "select 'a;b'; -- done", body: "select 'a;b'" },
  { dialect: 'postgres', sql: 'select 1 -- a;b\n', body: 'select 1 -- a;b' },
  { dialect: 'postgres', sql: 'select 1 -- ;\n; delete from orders', body: null },
  { dialect: 'postgres', sql: 'select 1; select 2', body: null },
  { dialect: 'postgres', sql: "select 'unclosed", body: null },
  { dialect: 'sqlite', sql: 'select text from notes; -- done', body: 'select text from notes' },
] as const)('it finds $body in `$sql` on $dialect', (row) => {
  expect(findStatementBody(row.dialect, row.sql)).toBe(row.body);
});
