import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from './with-file-lock.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-with-file-lock-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, lockPath: join(directory, 'locks', 'target-local.lock') };
}

test('it runs two holders of one lock one after the other', async () => {
  const ctx = await setupTest();

  const order: string[] = [];
  const firstIn = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const firstHolder = withFileLock({ path: ctx.lockPath, timeoutMs: 2000 }, async () => {
    order.push('first in');
    firstIn.resolve(undefined);

    await release.promise;

    order.push('first out');
  });

  await firstIn.promise;

  const secondHolder = withFileLock({ path: ctx.lockPath, timeoutMs: 2000 }, () =>
    Promise.resolve(order.push('second in')),
  );

  release.resolve(undefined);

  await Promise.all([firstHolder, secondHolder]);

  expect(order).toStrictEqual(['first in', 'first out', 'second in']);
});

test('it takes over a lock whose owner has died', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;

  await writeFile(join(ctx.directory, 'stale.lock'), String(dead));

  const result = await withFileLock(
    { path: join(ctx.directory, 'stale.lock'), timeoutMs: 1000 },
    () => Promise.resolve('held'),
  );

  expect(result).toBe('held');
});

test('it lets one of many callers at a time past a dead owner’s lock', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'stale.lock');

  await writeFile(path, String(dead));

  let inside = 0;
  let most = 0;

  const hold = (): Promise<void> =>
    withFileLock({ path, timeoutMs: 5000 }, async () => {
      inside += 1;
      most = Math.max(most, inside);

      await writeFile(join(ctx.directory, 'holder.txt'), String(inside));

      inside -= 1;
    });

  await Promise.all(Array.from({ length: 8 }, hold));

  expect(most).toBe(1);
});

test('it takes over an empty lock file', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'empty.lock'), '');

  const result = await withFileLock(
    { path: join(ctx.directory, 'empty.lock'), timeoutMs: 1000 },
    () => Promise.resolve('held'),
  );

  expect(result).toBe('held');
});

test('it fails with an environment error when a live owner keeps the lock past the timeout', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.directory, 'live.lock'), String(process.pid));

  expect(
    withFileLock({ path: join(ctx.directory, 'live.lock'), timeoutMs: 50 }, () =>
      Promise.resolve('held'),
    ),
  ).rejects.toMatchObject({ code: 'environment' });
});
