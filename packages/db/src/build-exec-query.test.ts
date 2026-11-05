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
    deadlineAtMs: 1_800_000_000_000,
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
    deadlineAtMs: 1_800_000_000_000,
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
      deadlineAtMs: 1_800_000_000_000,
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
    deadlineAtMs: 1_800_000_000_000,
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
      "do $wringer$ declare left_ms bigint := 1800000000000 - floor(extract(epoch from clock_timestamp()) * 1000)::bigint; begin if left_ms < 1 then raise exception 'The command''s deadline passed before the statement started.'; end if; perform set_config('statement_timeout', left_ms::text, false); end $wringer$;\nbegin read only;\nselect coalesce(json_agg(q), '[]'::json) from (\nselect id from orders\n) q;\ncommit;\n",
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
        deadlineAtMs: 1_800_000_000_000,
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
      deadlineAtMs: 1_800_000_000_000,
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
      deadlineAtMs: 1_800_000_000_000,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it sends a Postgres write limited to its deadline and reads its command tag back', () => {
  const query = buildExecQuery({
    dialect: 'postgres',
    program: ['psql'],
    database: 'shop',
    sql: 'delete from orders',
    params: [],
    write: true,
    deadlineAtMs: 1_800_000_001_200.4,
  });

  expect(query).toStrictEqual({
    argv: ['psql', '-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', 'shop'],
    stdin:
      "do $wringer$ declare left_ms bigint := 1800000001200 - floor(extract(epoch from clock_timestamp()) * 1000)::bigint; begin if left_ms < 1 then raise exception 'The command''s deadline passed before the statement started.'; end if; perform set_config('statement_timeout', left_ms::text, false); end $wringer$;\ndelete from orders",
    output: 'command-tag',
  });
});
