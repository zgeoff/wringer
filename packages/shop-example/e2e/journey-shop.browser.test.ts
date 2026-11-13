import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import type { DispatchResult } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { parsePublishedEnvelope } from '@wringer/core/test-utils/parse-published-envelope.ts';
import type { PublishedEnvelopeResult } from '@wringer/core/test-utils/parse-published-envelope.ts';
import { httpResponseSchema } from '@wringer/http';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createShopRegistry } from '../src/create-shop-registry.ts';
import { ordersSchema } from '../src/shop-contract.ts';

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

  await mkdir(join(ctx.root, 'packages', 'shop-example', 'src'), { recursive: true });

  await writeFile(
    join(ctx.root, 'packages', 'shop-example', 'src', 'shop-page.html'),
    '<button type="button">Place order</button>\n',
  );

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['use'], { feature: 'place-order' });
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

  const features = [
    expect.objectContaining({ name: 'place-order', status: 'verified' }),
    expect.objectContaining({ name: 'order-failure', status: 'unchanged' }),
    expect.objectContaining({ name: 'list-orders', status: 'unchanged' }),
    expect.objectContaining({ name: 'order-log', status: 'unchanged' }),
    expect.objectContaining({ name: 'guide', status: 'unchanged' }),
  ];

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
    done: expect.objectContaining({ feature: 'place-order', run: done.envelope.instance }),
    report: expect.objectContaining({
      report: expect.objectContaining({ complete: true, features }),
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
  await ctx.run(['use'], { feature: 'place-order' });
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
