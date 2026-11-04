import { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeSqlite3 } from './create-fake-sqlite3.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-fake-sqlite3-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const program = await createFakeSqlite3(directory);

  const file = join(directory, 'shop.db');

  return {
    file,
    run: async (args: readonly string[], sql: string) => {
      const child = Bun.spawn([program, ...args], {
        stdin: Buffer.from(sql),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stdout, stderr };
    },
  };
}

test('it prints the rows of a read as JSON', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (text text)');
  database.run("insert into notes values ('pay')");
  database.close();

  const result = await ctx.run(['-json', '-readonly', ctx.file], 'select text from notes');

  expect(result).toStrictEqual({ exitCode: 0, stdout: '[{"text":"pay"}]\n', stderr: '' });
});

test('it refuses a write with -readonly as sqlite3 does', async () => {
  const ctx = await setupTest();

  const database = new Database(ctx.file);

  database.run('create table notes (text text)');
  database.close();

  const result = await ctx.run(['-json', '-readonly', ctx.file], "insert into notes values ('x')");

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: '',
    stderr: 'Error: attempt to write a readonly database\n',
  });
});
