import { expect, onTestFinished, test } from 'bun:test';
import { SQL } from 'bun';
import { waitFor } from '../../core/test-utils/wait-for.ts';
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

test('it runs a pg_sleep statement until pg_cancel_backend names its application_name', async () => {
  const ctx = setupTest();

  const sleeper = new SQL(ctx.postgres.url, { connection: { application_name: 'shop-sleeper' } });

  onTestFinished(() => sleeper.close());

  const sleeping = sleeper.unsafe('select pg_sleep(60)', [1]).execute();

  await waitFor(() => (ctx.postgres.statements.length > 0 ? true : null));

  await ctx.client.unsafe('select pg_cancel_backend(pid) where name = $1', ['shop-other']);
  await ctx.client.unsafe('select pg_cancel_backend(pid) where name = $1', ['shop-sleeper']);

  expect(sleeping).rejects.toMatchObject({ errno: '57014' });
});

test('it records a simple query as a simple-protocol statement', async () => {
  const ctx = setupTest();

  await ctx.client.unsafe('select 1; select 2').simple();

  expect(ctx.postgres.statements).toStrictEqual([
    { protocol: 'simple', sql: 'select 1; select 2' },
  ]);
});
