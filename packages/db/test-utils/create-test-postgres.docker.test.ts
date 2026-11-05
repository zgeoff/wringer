import { expect, onTestFinished, test } from 'bun:test';
import { $, SQL } from 'bun';
import { createTestPostgres } from './create-test-postgres.ts';

// One stack frees what each test took, in the reverse of the order it took it: the client, then
// the container.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const postgres = await createTestPostgres();

  stack.defer(() => {
    postgres.remove();
  });

  const client = new SQL(postgres.url);

  stack.defer(() => client.close());

  return { postgres, client };
}

test('it starts a Postgres that answers a query at its URL', async () => {
  const ctx = await setupTest();
  const rows: unknown[] = await ctx.client`select current_user as role`;

  expect(rows).toStrictEqual([{ role: 'shop' }]);
});

test('it removes the data volume of its container along with the container', async () => {
  const ctx = await setupTest();

  const volumes =
    await $`docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' ${ctx.postgres.containerID}`.text();

  ctx.postgres.remove();

  const left = await $`docker volume ls --quiet`.text();

  const names = volumes.trim().split(' ');

  expect({
    named: names.length,
    left: names.filter((name) => left.split('\n').includes(name)),
  }).toStrictEqual({ named: 1, left: [] });
});
