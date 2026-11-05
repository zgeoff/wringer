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
    timeLeftMs: 30_000,
  });

  expect(query).toStrictEqual({
    argv: ['sqlite3', '-safe', '-json', '-readonly', '/srv/shop.db'],
    stdin: 'select * from notes',
    output: 'rows',
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
    timeLeftMs: 30_000,
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
      timeLeftMs: 30_000,
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
    timeLeftMs: 30_000,
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
      "set statement_timeout = 30000;\nbegin read only;\nselect coalesce(json_agg(q), '[]'::json) from (\nselect id from orders\n) q;\ncommit;\n",
    output: 'rows',
  });
});

test.each(['show server_version', 'explain select id from orders'])(
  'it refuses the Postgres read `%s`, which the JSON subquery cannot hold, with a usage error',
  (sql) => {
    expect(() =>
      buildExecQuery({
        dialect: 'postgres',
        program: ['psql'],
        database: 'shop',
        sql,
        params: [],
        write: false,
        timeLeftMs: 30_000,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'usage', hint: 'Connect with `via: sql` to run it.' }),
    );
  },
);

test.each([
  { name: 'read', sql: 'select 1) q; commit; delete from orders; --', write: false },
  { name: 'write', sql: 'update orders set paid = true; select pg_sleep(60);', write: true },
])('it rejects a Postgres $name that holds a second statement', (row) => {
  expect(() =>
    buildExecQuery({
      dialect: 'postgres',
      program: ['psql'],
      database: 'shop',
      sql: row.sql,
      params: [],
      write: row.write,
      timeLeftMs: 30_000,
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
      timeLeftMs: 30_000,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it sends a Postgres write limited to the time left and reads its command tag back', () => {
  const query = buildExecQuery({
    dialect: 'postgres',
    program: ['psql'],
    database: 'shop',
    sql: 'delete from orders',
    params: [],
    write: true,
    timeLeftMs: 1200.4,
  });

  expect(query).toStrictEqual({
    argv: ['psql', '-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', 'shop'],
    stdin: 'set statement_timeout = 1201;\ndelete from orders',
    output: 'command-tag',
  });
});

test('it limits a Postgres statement with no time left to 1 ms, since 0 turns the limit off', () => {
  const query = buildExecQuery({
    dialect: 'postgres',
    program: ['psql'],
    database: 'shop',
    sql: 'delete from orders',
    params: [],
    write: true,
    timeLeftMs: 0,
  });

  expect(query.stdin).toBe('set statement_timeout = 1;\ndelete from orders');
});
