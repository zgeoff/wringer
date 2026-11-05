import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { createDbWringer } from '../test-utils/create-db-wringer.ts';
import { createDockerSqlite3 } from '../test-utils/create-docker-sqlite3.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'db-docker');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'shop.db');

  const sqlite3 = await createDockerSqlite3(directory);

  const wringer = createDbWringer({ file, sqlite3 });

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    directory,

    // `using` closes the database even when a statement throws.
    seedNotes: (texts: readonly string[]) => {
      using database = new Database(file);

      database.run('create table notes (id integer primary key, text text not null)');

      for (const text of texts) {
        database.run('insert into notes (text) values (?)', [text]);
      }
    },
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('it names the columns of a read through the real sqlite3 client that returns no rows', async () => {
  const ctx = await setupTest();

  ctx.seedNotes(['pay']);

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const result = await ctx.run('box', ['db', 'query'], {
    sql: "select id, text as label from notes where text = 'ship'",
  });

  expect(result.envelope.data).toStrictEqual({ columns: ['id', 'label'], rows: [], rowCount: 0 });
});

test('it fails a shell command sent to the real sqlite3 client without running it', async () => {
  const ctx = await setupTest();

  const flag = join(ctx.directory, 'flag');

  ctx.seedNotes(['pay']);

  await ctx.run('bench', ['attach']);
  await ctx.run('bench', ['doctor']);

  const result = await ctx.run('bench', ['db', 'query'], {
    sql: `.shell touch ${flag}`,
    write: true,
  });

  expect({ code: result.envelope.error?.code, ran: await Bun.file(flag).exists() }).toStrictEqual({
    code: 'usage',
    ran: false,
  });
});
