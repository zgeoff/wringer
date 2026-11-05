import { expect, test } from 'bun:test';
import { pickDatabaseFailure } from './pick-database-failure.ts';

test.each([
  { name: 'the SQLite read-only code', code: 'SQLITE_READONLY', message: '', failure: 'read-only' },
  { name: 'the Postgres read-only SQLSTATE', code: '25006', message: '', failure: 'read-only' },
  {
    name: 'the sqlite3 read-only message',
    code: null,
    message: 'Error: attempt to write a readonly database',
    failure: 'read-only',
  },
  {
    name: 'the psql read-only message',
    code: null,
    message: 'ERROR:  cannot execute INSERT in a read-only transaction',
    failure: 'read-only',
  },
  {
    name: 'a SQLite file it cannot open',
    code: 'SQLITE_CANTOPEN',
    message: '',
    failure: 'environment',
  },
  { name: 'a refused connection', code: 'ECONNREFUSED', message: '', failure: 'environment' },
  { name: 'a Postgres connection SQLSTATE', code: '08006', message: '', failure: 'environment' },
  { name: 'an unknown Postgres database', code: '3D000', message: '', failure: 'environment' },
  {
    name: 'the psql connection message',
    code: null,
    message: 'psql: error: connection to server on socket "/run/pg.sock" failed',
    failure: 'environment',
  },
  {
    name: 'the sqlite3 locked message',
    code: null,
    message: 'Runtime error near line 1: database is locked (5)',
    failure: 'environment',
  },
  {
    name: 'the sqlite3 not-a-database message',
    code: null,
    message: 'Error: file is not a database',
    failure: 'environment',
  },
  {
    name: 'the sqlite3 disk message',
    code: null,
    message: 'Error: disk I/O error',
    failure: 'environment',
  },
  {
    name: 'the sqlite3 full-disk message',
    code: null,
    message: 'Error: database or disk is full',
    failure: 'environment',
  },
  {
    name: 'the sqlite3 permission message',
    code: null,
    message: 'Error: access permission denied',
    failure: 'environment',
  },
  {
    name: 'a missing table',
    code: 'SQLITE_ERROR',
    message: 'no such table: notes',
    failure: 'statement',
  },
  { name: 'a Postgres syntax error', code: '42601', message: '', failure: 'statement' },
  {
    name: 'the Postgres statement timeout SQLSTATE',
    code: '57014',
    message: '',
    failure: 'timeout',
  },
  {
    name: 'the psql statement timeout message',
    code: null,
    message: 'ERROR:  canceling statement due to statement timeout',
    failure: 'timeout',
  },
  {
    name: "the psql message of the driver's deadline check",
    code: null,
    message: "ERROR:  The command's deadline passed before the statement started.",
    failure: 'timeout',
  },
])('it reads $name as $failure', (row) => {
  expect(pickDatabaseFailure(row.code, row.message)).toBe(row.failure);
});
