import { expect, test } from 'bun:test';
import { buildExecQuery } from './build-exec-query.ts';

test('it opens SQLite read-only and in safe mode for a read', () => {
  const query = buildExecQuery({
    dialect: 'sqlite',
    program: ['sqlite3'],
    database: '/srv/shop.db',
    sql: 'select * from notes',
    params: [],
    write: false,
  });

  expect(query).toStrictEqual({
    argv: ['sqlite3', '-safe', '-json', '-readonly', '/srv/shop.db'],
    stdin: 'select * from notes',
    printsRows: true,
  });
});

test('it opens SQLite for writing for a write', () => {
  const query = buildExecQuery({
    dialect: 'sqlite',
    program: ['docker', 'exec', '-i', 'shop', 'sqlite3'],
    database: '/data/shop.db',
    sql: 'delete from notes',
    params: [],
    write: true,
  });

  expect(query.argv).toStrictEqual([
    'docker',
    'exec',
    '-i',
    'shop',
    'sqlite3',
    '-safe',
    '-json',
    '/data/shop.db',
  ]);
});

test('it rejects params for a target that runs the database client', () => {
  expect(() =>
    buildExecQuery({
      dialect: 'sqlite',
      program: ['sqlite3'],
      database: '/srv/shop.db',
      sql: 'select * from notes where id = ?',
      params: [7],
      write: false,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it wraps a Postgres read in a read-only transaction that prints JSON', () => {
  const query = buildExecQuery({
    dialect: 'postgres',
    program: ['psql'],
    database: 'postgres://shop@db/shop',
    sql: 'select id from orders;',
    params: [],
    write: false,
  });

  expect(query).toStrictEqual({
    argv: [
      'psql',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      'postgres://shop@db/shop',
    ],
    stdin:
      "begin read only;\nselect coalesce(json_agg(q), '[]'::json) from (\nselect id from orders\n) q;\ncommit;\n",
    printsRows: true,
  });
});

test('it rejects a Postgres read that holds a second statement', () => {
  expect(() =>
    buildExecQuery({
      dialect: 'postgres',
      program: ['psql'],
      database: 'shop',
      sql: 'select 1) q; commit; delete from orders; --',
      params: [],
      write: false,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it rejects a Postgres statement that holds a psql command', () => {
  expect(() =>
    buildExecQuery({
      dialect: 'postgres',
      program: ['psql'],
      database: 'shop',
      sql: 'select 1 \\! touch /tmp/owned',
      params: [],
      write: true,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it sends a Postgres write as it is and reads no rows back', () => {
  const query = buildExecQuery({
    dialect: 'postgres',
    program: ['psql'],
    database: 'shop',
    sql: 'delete from orders',
    params: [],
    write: true,
  });

  expect({ stdin: query.stdin, printsRows: query.printsRows }).toStrictEqual({
    stdin: 'delete from orders',
    printsRows: false,
  });
});
