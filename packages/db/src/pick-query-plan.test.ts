import { expect, test } from 'bun:test';
import { pickQueryPlan } from './pick-query-plan.ts';

test('it runs a SQLite read over Bun.SQL as it was asked', () => {
  const plan = pickQueryPlan(
    { via: 'sql', adapter: 'sqlite', url: '/srv/shop.db' },
    { sql: 'select id from notes where id = ?', params: [2], write: false },
    1_800_000_000_000,
  );

  expect(plan).toStrictEqual({
    kind: 'sql',
    adapter: 'sqlite',
    url: '/srv/shop.db',
    sql: 'select id from notes where id = ?',
    params: [2],
    write: false,
  });
});

test('it plans a read that copies a SQLite database elsewhere as an undeclared write', () => {
  const plan = pickQueryPlan(
    { via: 'sql', adapter: 'sqlite', url: '/srv/shop.db' },
    { sql: "vacuum into '/srv/copy.db'", params: [], write: false },
    1_800_000_000_000,
  );

  expect(plan).toStrictEqual({ kind: 'undeclared-write' });
});

test('it plans a Postgres write sent as a read through psql as an undeclared write', () => {
  const plan = pickQueryPlan(
    { via: 'exec', dialect: 'postgres', database: 'shop' },
    { sql: 'delete from orders', params: [], write: false },
    1_800_000_000_000,
  );

  expect(plan).toStrictEqual({ kind: 'undeclared-write' });
});

test('it runs a granted write through the client as a read of the target', () => {
  const plan = pickQueryPlan(
    {
      via: 'exec',
      dialect: 'sqlite',
      database: '/srv/shop.db',
      readOnly: { allow: ["update notes set text = 'archived' where id = 1"] },
    },
    { sql: "update notes set text = 'archived' where id = 1", params: [], write: true },
    1_800_000_000_000,
  );

  expect(plan).toStrictEqual({
    kind: 'exec',
    exec: {
      argv: ['sqlite3', '-safe', '-json', '/srv/shop.db'],
      stdin: "update notes set text = 'archived' where id = 1",
      output: 'rows',
    },
    effect: 'read',
    write: true,
  });
});
