import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { dispatch } from '../packages/core/src/index.ts';
import type { DispatchResult } from '../packages/core/src/index.ts';
import { createTestSession } from '../packages/core/test-utils/create-test-session.ts';
import { httpResponseSchema } from '../packages/http/src/index.ts';
import { parsePublishedEnvelope } from '../test-utils/parse-published-envelope.ts';
import type { PublishedEnvelopeResult } from '../test-utils/parse-published-envelope.ts';
import { createShopRegistry } from './create-shop-registry.ts';
import { ordersSchema } from './shop-contract.ts';

async function setupTest() {
  const registry = createShopRegistry();

  const shop = await createTestSession({ parent: import.meta.dir, wringer: registry });

  const results: DispatchResult[] = [];

  return {
    root: shop.repo.root,
    results,
    run: async (path: readonly string[], args: unknown = {}) => {
      const result = await dispatch(registry, path, args, { ...shop.session, target: 'local' });

      results.push(result);

      return result;
    },
  };
}

test('it drives a page, an http call, a stream read and a db query, then reports the feature verified', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'checkout'), { recursive: true });
  await writeFile(join(ctx.root, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['browser', 'goto'], { path: '/' });
  await ctx.run(['browser', 'click'], { role: 'button', name: 'Place order' });

  const orders = await waitFor(async () => {
    const result = await ctx.run(['http', 'request'], { path: '/api/orders' });

    const listed = ordersSchema.parse(httpResponseSchema.parse(result.envelope.data).json);

    invariant(listed.length > 0, 'The shop lists no order yet.');

    return listed;
  });

  const logged = await waitFor(async () => {
    const result = await ctx.run(['stream', 'read'], { name: 'app' });

    invariant(
      JSON.stringify(result.envelope.data).includes('order 1 placed'),
      'The app stream has not recorded the order yet.',
    );

    return result;
  });

  const counted = await ctx.run(['db', 'query'], { sql: 'select count(*) as orders from orders' });
  const done = await ctx.run(['done']);
  const report = await ctx.run(['report']);

  const checkout = expect.objectContaining({ name: 'checkout', status: 'verified' });

  expect({
    orders,
    logged: logged.exitCode,
    counted: counted.envelope.data,
    done: done.envelope.data,
    report: report.envelope.data,
  }).toStrictEqual({
    orders: [{ id: 1, item: 'mug' }],
    logged: 0,
    counted: { columns: ['orders'], rows: [{ orders: 1 }], rowCount: 1 },
    done: expect.objectContaining({ feature: 'checkout', run: done.envelope.instance }),
    report: expect.objectContaining({
      report: expect.objectContaining({ complete: true, features: [checkout] }),
    }),
  });
});

test('it shows on the page that an order failed', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['db', 'query'], { sql: 'drop table orders', write: true });
  await ctx.run(['browser', 'goto'], { path: '/' });
  await ctx.run(['browser', 'click'], { role: 'button', name: 'Place order' });

  const shown = await waitFor(async () => {
    const result = await ctx.run(['browser', 'snapshot']);

    invariant(
      JSON.stringify(result.envelope.data).includes('The order failed'),
      'The page does not show the failed order yet.',
    );

    return true;
  });

  expect(shown).toBeTrue();
});

test('it writes every envelope of the journey in the published schema', async () => {
  const ctx = await setupTest();

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['browser', 'goto'], { path: '/' });
  await ctx.run(['browser', 'snapshot']);
  await ctx.run(['http', 'request'], { path: '/api/orders' });
  await ctx.run(['stream', 'read'], { name: 'app', from: 0 });
  await ctx.run(['db', 'query'], { sql: 'select count(*) as orders from orders' });
  await ctx.run(['done']);
  await ctx.run(['report']);
  await ctx.run(['db', 'query'], { sql: 'delete from orders' });

  const published = ctx.results.map((result) =>
    parsePublishedEnvelope(JSON.stringify(result.envelope)),
  );

  expect(published).toSatisfyAll((parsed: PublishedEnvelopeResult) => parsed.valid);
});
