import { expect, test } from 'bun:test';
import { isUndeclaredWrite } from './is-undeclared-write.ts';

test.each([
  { dialect: 'sqlite', via: 'sql', sql: 'select text from notes', write: false },
  { dialect: 'sqlite', via: 'sql', sql: "VACUUM INTO '/srv/copy.db'", write: true },
  { dialect: 'sqlite', via: 'exec', sql: "vacuum into '/srv/copy.db'", write: true },
  { dialect: 'sqlite', via: 'sql', sql: "attach '/srv/other.db' as other", write: true },
  { dialect: 'sqlite', via: 'sql', sql: 'pragma query_only = 0', write: true },
  { dialect: 'sqlite', via: 'sql', sql: "select 'vacuum' as label", write: false },
  { dialect: 'sqlite', via: 'sql', sql: 'select 1 /* attach */', write: false },
  { dialect: 'postgres', via: 'sql', sql: 'delete from orders', write: false },
  { dialect: 'postgres', via: 'exec', sql: 'select id from orders', write: false },
  {
    dialect: 'postgres',
    via: 'exec',
    sql: '  -- open orders\n(select id from orders)',
    write: false,
  },
  {
    dialect: 'postgres',
    via: 'exec',
    sql: 'with open as (select 1) select * from open',
    write: false,
  },
  { dialect: 'postgres', via: 'exec', sql: 'delete from orders', write: true },
  { dialect: 'postgres', via: 'exec', sql: '/* tidy */ insert into notes values (1)', write: true },
] as const)('it reads `$sql` on $dialect over $via as a write: $write', (row) => {
  expect(isUndeclaredWrite(row.dialect, row.via, row.sql)).toBe(row.write);
});
