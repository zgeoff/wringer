import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '../packages/core/src/index.ts';
import type { DispatchResult } from '../packages/core/src/index.ts';
import { createTestSession } from '../packages/core/test-utils/create-test-session.ts';
import { waitFor } from '../packages/core/test-utils/wait-for.ts';
import { parsePublishedEnvelope } from '../test-utils/parse-published-envelope.ts';
import type { PublishedEnvelopeResult } from '../test-utils/parse-published-envelope.ts';
import { createShopRegistry } from './create-shop-registry.ts';

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

    return JSON.stringify(result.envelope.data).includes('"item":"mug"') ? result : null;
  });

  const logged = await waitFor(async () => {
    const result = await ctx.run(['stream', 'read'], { name: 'app' });

    return JSON.stringify(result.envelope.data).includes('order 1 placed') ? result : null;
  });

  const counted = await ctx.run(['db', 'query'], { sql: 'select count(*) as orders from orders' });
  const done = await ctx.run(['done']);
  const report = await ctx.run(['report']);

  const checkout = expect.objectContaining({ name: 'checkout', status: 'verified' });

  expect({
    orders: orders.exitCode,
    logged: logged.exitCode,
    counted: counted.envelope.data,
    done: done.envelope.data,
    report: report.envelope.data,
  }).toStrictEqual({
    orders: 0,
    logged: 0,
    counted: { columns: ['orders'], rows: [{ orders: 1 }] },
    done: expect.objectContaining({ feature: 'checkout', run: done.envelope.instance }),
    report: expect.objectContaining({
      report: expect.objectContaining({ complete: true, features: [checkout] }),
    }),
  });
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
