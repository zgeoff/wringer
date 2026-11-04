import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { createDbWringer } from '../test-utils/create-db-wringer.ts';
import { createFakeSqlite3 } from '../test-utils/create-fake-sqlite3.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-db-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');

  const sqlite3 = await createFakeSqlite3(directory);

  const wringer = createDbWringer({ file, sqlite3 });

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    file,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('it reads rows with their column names', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.run("insert into notes (text) values ('pay'), ('ship')");
  database.close();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['db', 'query'], { sql: 'select id, text from notes' });

  expect(result.envelope.data).toStrictEqual({
    columns: ['id', 'text'],
    rows: [
      { id: 1, text: 'pay' },
      { id: 2, text: 'ship' },
    ],
  });
});

test('it runs a write that asks to write on a target that may write', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.close();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['db', 'query'], {
    sql: "insert into notes (text) values ('pay') returning id",
    write: true,
  });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { columns: ['id'], rows: [{ id: 1 }] },
  });
});

test('it refuses a write that did not ask to write, with a usage error', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.close();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['db', 'query'], {
    sql: "insert into notes (text) values ('pay')",
  });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: {
      code: 'usage',
      message:
        "The statement `insert into notes (text) values ('pay')` writes, but the query did not ask to write.",
      hint: 'Add `--write`, or `write: true`, to a statement that writes.',
    },
  });
});

test.each([
  {
    name: 'a write that asks to write, at the command',
    args: { sql: "insert into notes (text) values ('pay')", write: true },
    message: '`db query` is a write, and target prod is read-only.',
  },
  {
    name: 'a write that did not ask to write, in the database',
    args: { sql: "insert into notes (text) values ('pay')" },
    message:
      "The statement `insert into notes (text) values ('pay')` is a write, and the target is read-only.",
  },
])('it refuses $name on a read-only target with exit code 3 and the hint', async (row) => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.close();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['db', 'query'], row.args);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: row.message,
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it refuses a write inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.close();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak-insert']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'read-only',
  });
});

test('it runs the write a read-only target grants', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.run("insert into notes (text) values ('pay')");
  database.close();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  await ctx.run('prod', ['db', 'query'], {
    sql: "update notes set text = 'archived' where id = 1",
    write: true,
  });

  const result = await ctx.run('prod', ['db', 'query'], { sql: 'select text from notes' });

  expect(result.envelope.data).toStrictEqual({ columns: ['text'], rows: [{ text: 'archived' }] });
});

test('it reads rows through the database client on the target host', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.run("insert into notes (text) values ('pay')");
  database.close();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const result = await ctx.run('box', ['db', 'query'], { sql: 'select text from notes' });

  expect(result.envelope.data).toStrictEqual({ columns: ['text'], rows: [{ text: 'pay' }] });
});

test('it refuses an undeclared write through the database client with exit code 3', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text not null)');
  database.close();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const result = await ctx.run('box', ['db', 'query'], {
    sql: "insert into notes (text) values ('pay')",
  });

  expect({ exitCode: result.exitCode, hint: result.envelope.error?.hint }).toStrictEqual({
    exitCode: 3,
    hint: 'prod is read-only: reproduce it on local.',
  });
});
