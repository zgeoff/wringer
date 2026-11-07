import { expect, onTestFinished, test } from 'bun:test';
import { waitFor } from '@zgeoff/testing/helpers';
import { SQL } from 'bun';
import invariant from 'tiny-invariant';
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

  await waitFor(() => {
    invariant(ctx.postgres.statements.length > 0, 'No statement has reached postgres yet.');
  });

  await ctx.client.unsafe('select pg_cancel_backend(pid) where name = $1', ['shop-other']);
  await ctx.client.unsafe('select pg_cancel_backend(pid) where name = $1', ['shop-sleeper']);

  expect(sleeping).rejects.toMatchObject({ errno: '57014' });
});

test('it refuses the first connection a cancel loop opens, then lets the next one in', async () => {
  const postgres = createFakePostgres({ cancelRefusals: 1 });

  onTestFinished(() => {
    postgres.stop();
  });

  const first = new SQL(postgres.url, { max: 1, connection: { application_name: 'shop-cancel' } });
  const second = new SQL(postgres.url, { max: 1, connection: { application_name: 'shop-cancel' } });

  onTestFinished(() => first.close());
  onTestFinished(() => second.close());

  const [refused] = await Promise.allSettled([first.unsafe('select 1', []).execute()]);

  await second.unsafe('select 1', []);

  expect(refused).toMatchObject({ status: 'rejected', reason: { errno: '53300' } });
});

test('it records a simple query as a simple-protocol statement', async () => {
  const ctx = setupTest();

  await ctx.client.unsafe('select 1; select 2').simple();

  expect(ctx.postgres.statements).toStrictEqual([
    { protocol: 'simple', sql: 'select 1; select 2' },
  ]);
});
