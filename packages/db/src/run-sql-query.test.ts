import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runSQLQuery } from './run-sql-query.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-run-sql-query-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { file: join(directory, 'shop.db') };
}

test('it reads rows with bound parameters', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text)');
  database.run("insert into notes (text) values ('pay'), ('ship')");
  database.close();

  const rows = await runSQLQuery({
    adapter: 'sqlite',
    url: ctx.file,
    sql: 'select text from notes where id = ?',
    params: [2],
    write: false,
  });

  expect(rows).toStrictEqual([{ text: 'ship' }]);
});

test('it lets SQLite refuse a write on a read', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (id integer primary key, text text)');
  database.close();

  const query = runSQLQuery({
    adapter: 'sqlite',
    url: ctx.file,
    sql: "insert into notes (text) values ('pay')",
    params: [],
    write: false,
  });

  expect(query).rejects.toMatchObject({ code: 'SQLITE_READONLY' });
});
