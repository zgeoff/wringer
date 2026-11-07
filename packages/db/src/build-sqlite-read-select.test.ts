import { expect, test } from 'bun:test';
import { buildSqliteReadSelect } from './build-sqlite-read-select.ts';

test.each([
  ['select id from notes', 'select id from notes'],
  ['with n as (select 1 as id) select id from n', 'with n as (select 1 as id) select id from n'],
  ['values (1, 2)', 'values (1, 2)'],
  ['pragma table_list', 'select * from "pragma_table_list"'],
  ['pragma table_info(notes)', `select * from "pragma_table_info" where arg = 'notes'`],
  ['PRAGMA "table_info"("my notes")', `select * from "pragma_table_info" where arg = 'my notes'`],
  ["pragma table_info('o''clock')", `select * from "pragma_table_info" where arg = 'o''clock'`],
  ['pragma integrity_check(-12)', `select * from "pragma_integrity_check" where arg = '-12'`],
  ['pragma table_info = notes', `select * from "pragma_table_info" where arg = 'notes'`],
])('it builds the select for the read %p', (statement, select) => {
  expect(buildSqliteReadSelect(statement)).toBe(select);
});

test.each([
  ['explain select 1', 'A read through sqlite3 cannot run `explain`.'],
  ['pragma main.table_info(notes)', 'A pragma read through sqlite3 names no schema.'],
  [
    'pragma table_info(notes',
    'A pragma read through sqlite3 is `pragma name`, `pragma name(value)` or `pragma name = value`.',
  ],
  [
    'pragma table_info(notes, id)',
    'A pragma read through sqlite3 is `pragma name`, `pragma name(value)` or `pragma name = value`.',
  ],
  [
    'pragma table_info()',
    'A pragma read through sqlite3 is `pragma name`, `pragma name(value)` or `pragma name = value`.',
  ],
])('it refuses the read %p with a usage error', (statement, message) => {
  expect(() => buildSqliteReadSelect(statement)).toThrow(
    expect.objectContaining({ code: 'usage', message }),
  );
});
