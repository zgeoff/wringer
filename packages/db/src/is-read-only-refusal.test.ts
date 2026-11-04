import { expect, test } from 'bun:test';
import { isReadOnlyRefusal } from './is-read-only-refusal.ts';

test.each([
  { name: 'the SQLite driver code', code: 'SQLITE_READONLY', message: '', refusal: true },
  { name: 'the Postgres SQLSTATE', code: '25006', message: '', refusal: true },
  {
    name: 'the sqlite3 message',
    code: null,
    message: 'Error: attempt to write a readonly database',
    refusal: true,
  },
  {
    name: 'the psql message',
    code: null,
    message: 'ERROR:  cannot execute INSERT in a read-only transaction',
    refusal: true,
  },
  { name: 'another error', code: 'SQLITE_ERROR', message: 'no such table: notes', refusal: false },
])('it reads $name', (row) => {
  expect(isReadOnlyRefusal(row.code, row.message)).toBe(row.refusal);
});
