import { expect, test } from 'bun:test';
import { buildExecQuery } from './build-exec-query.ts';

test('it opens SQLite read-only and in safe mode for a read, and names its columns first', () => {
  const query = buildExecQuery({
    dialect: 'sqlite',
    program: ['sqlite3'],
    database: '/srv/shop.db',
    sql: 'select * from notes;',
    params: [],
    write: false,
    deadlineAtMs: 1_800_000_000_000,
  });

  expect(query).toStrictEqual({
    argv: ['sqlite3', '-safe', '-json', '-readonly', '/srv/shop.db'],
    stdin:
      "create temp view wringer_read as\nselect * from notes\n;\nselect json_group_array(name) as wringer_columns from pragma_table_info('wringer_read');\nselect * from wringer_read;\n",
    output: 'columns-then-rows',
  });
});

test('it reads a SQLite pragma through its table-valued function, so its columns come first', () => {
  const query = buildExecQuery({
    dialect: 'sqlite',
    program: ['sqlite3'],
    database: '/srv/shop.db',
    sql: 'pragma table_info(notes)',
    params: [],
    write: false,
    deadlineAtMs: 1_800_000_000_000,
  });

  expect(query).toStrictEqual({
    argv: ['sqlite3', '-safe', '-json', '-readonly', '/srv/shop.db'],
    stdin: `create temp view wringer_read as\nselect * from "pragma_table_info" where arg = 'notes'\n;\nselect json_group_array(name) as wringer_columns from pragma_table_info('wringer_read');\nselect * from wringer_read;\n`,
    output: 'columns-then-rows',
  });
});

test('it names the SQLite view after nothing the read mentions', () => {
  const query = buildExecQuery({
    dialect: 'sqlite',
    program: ['sqlite3'],
    database: '/srv/shop.db',
    sql: 'select * from WRINGER_READ join wringer_read_1 using (id)',
    params: [],
    write: false,
    deadlineAtMs: 1_800_000_000_000,
  });

  expect(query.stdin).toBe(
    "create temp view wringer_read_2 as\nselect * from WRINGER_READ join wringer_read_1 using (id)\n;\nselect json_group_array(name) as wringer_columns from pragma_table_info('wringer_read_2');\nselect * from wringer_read_2;\n",
  );
});

test('it refuses a SQLite read of two statements with a usage error', () => {
  expect(() =>
    buildExecQuery({
      dialect: 'sqlite',
      program: ['sqlite3'],
      database: '/srv/shop.db',
      sql: 'select 1; select 2',
      params: [],
      write: false,
      deadlineAtMs: 1_800_000_000_000,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
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

test('it wraps a Postgres read in a read-only transaction that prints its columns and rows as JSON', () => {
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
      '-v',
      'VERBOSITY=verbose',
      '-d',
      'postgres://shop@db/shop',
    ],
    stdin:
      "do $wringer$ declare left_ms bigint := 1800000000000 - floor(extract(epoch from clock_timestamp()) * 1000)::bigint; begin if left_ms < 1 then raise exception 'The command''s deadline passed before the statement started.'; end if; perform set_config('statement_timeout', left_ms::text, false); end $wringer$;\nbegin read only;\nwith q as materialized (\nselect id from orders\n) select json_build_object('columns', (select coalesce(json_agg(k), '[]'::json) from json_object_keys((select to_json(r) from (select q.* from (values (1)) d(x) left join q on true limit 1) r)) k), 'rows', (select coalesce(json_agg(q), '[]'::json) from q));\ncommit;\n",
    output: 'columns-and-rows',
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
      sql: String.raw`select 1 \! touch /tmp/owned`,
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
    argv: [
      'psql',
      '-X',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
      '-d',
      'shop',
    ],
    stdin:
      "do $wringer$ declare left_ms bigint := 1800000001200 - floor(extract(epoch from clock_timestamp()) * 1000)::bigint; begin if left_ms < 1 then raise exception 'The command''s deadline passed before the statement started.'; end if; perform set_config('statement_timeout', left_ms::text, false); end $wringer$;\ndelete from orders",
    output: 'command-tag',
  });
});
