import { expect, onTestFinished, test } from 'bun:test';
import { SQL } from 'bun';
import { createTestPostgres } from './create-test-postgres.ts';

async function setupTest() {
  const postgres = await createTestPostgres();

  onTestFinished(() => {
    postgres.remove();
  });

  const client = new SQL(postgres.url);

  onTestFinished(() => client.close());

  return { client };
}

test('it starts a Postgres that answers a query at its URL', async () => {
  const ctx = await setupTest();
  const rows: unknown[] = await ctx.client`select current_user as role`;

  expect(rows).toStrictEqual([{ role: 'shop' }]);
});
