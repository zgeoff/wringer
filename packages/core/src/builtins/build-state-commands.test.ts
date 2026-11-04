import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createShopWringer } from '../../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../../test-utils/create-test-session.ts';
import { buildRunPaths } from '../build-state-paths.ts';
import { dispatch } from '../dispatch.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    readPointers: () => shop.state.readPointers(),
    streamsOf: (runID: string) =>
      buildRunPaths(join(shop.repo.root, wringer.stateDir), runID).streams,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('#use marks the cursors of the current target run', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  const streams = ctx.streamsOf(up.envelope.instance ?? '');

  await mkdir(streams, { recursive: true });
  await writeFile(join(streams, 'app.ndjson'), '{"at":"t","line":"booted"}\n');

  const result = await ctx.run('local', ['use'], { feature: 'checkout' });

  expect(result.envelope.data).toStrictEqual({
    target: null,
    feature: 'checkout',
    cursors: { app: 27 },
  });
});

test('#use saves the run that its cursors belong to', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  await ctx.run('local', ['use'], { feature: 'checkout' });

  const pointers = await ctx.readPointers();

  expect(pointers.cursorsRun).toBe(up.envelope.instance ?? '');
});

test('#use --target drops the run of cursors it no longer holds', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['use'], { feature: 'checkout' });
  await ctx.run('local', ['use'], { target: 'prod' });

  const pointers = await ctx.readPointers();

  expect(pointers.cursorsRun).toBeUndefined();
});

test('#use --target marks the cursors of the run of the target it selects', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  const streams = ctx.streamsOf(up.envelope.instance ?? '');

  await mkdir(streams, { recursive: true });
  await writeFile(join(streams, 'app.ndjson'), '{"at":"t","line":"booted"}\n');

  const result = await ctx.run('local', ['use'], { target: 'prod' });

  expect(result.envelope.data).toStrictEqual({ target: 'prod', feature: null, cursors: {} });
});
