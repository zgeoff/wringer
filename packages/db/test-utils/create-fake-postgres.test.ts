import { expect, onTestFinished, test } from 'bun:test';
import { SQL } from 'bun';
import { createFakePostgres } from './create-fake-postgres.ts';

function setupTest() {
  const postgres = createFakePostgres();

  onTestFinished(() => {
    postgres.stop();
  });

  const client = new SQL(postgres.url);

  onTestFinished(() => client.close());

  return { postgres, client };
}

test('it records a statement with parameters as an extended-protocol statement', async () => {
  const ctx = setupTest();

  await ctx.client.unsafe('select text from notes where id = $1', [7]);

  expect(ctx.postgres.statements).toStrictEqual([
    { protocol: 'extended', sql: 'select text from notes where id = $1' },
  ]);
});

test('it records a simple query as a simple-protocol statement', async () => {
  const ctx = setupTest();

  await ctx.client.unsafe('select 1; select 2').simple();

  expect(ctx.postgres.statements).toStrictEqual([
    { protocol: 'simple', sql: 'select 1; select 2' },
  ]);
});
