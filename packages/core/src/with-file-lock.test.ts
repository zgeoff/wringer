import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { formatLockOwner } from './format-lock-owner.ts';
import { readPIDNamespace } from './read-pid-namespace.ts';
import { withFileLock } from './with-file-lock.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'with-file-lock');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    directory,
    lockPath: join(directory, 'locks', 'target-local.lock'),
    namespace: readPIDNamespace(),
    claimPathOf: (lockPath: string, staleContent: string) =>
      `${lockPath}.${Bun.hash(staleContent).toString(36)}.claim`,
  };
}

test('it keeps a second caller out while the first holds the lock', async () => {
  const ctx = await setupTest();

  const firstIn = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const firstHolder = withFileLock({ path: ctx.lockPath, timeoutMs: 2000 }, async () => {
    firstIn.resolve(undefined);

    await release.promise;
  });

  onTestFinished(async () => {
    release.resolve(undefined);

    await firstHolder;
  });

  await firstIn.promise;

  expect(
    withFileLock({ path: ctx.lockPath, timeoutMs: 100 }, () => Promise.resolve('second in')),
  ).rejects.toMatchObject({ code: 'environment' });
});

test('it lets the next caller in once the first holder is done', async () => {
  const ctx = await setupTest();

  await withFileLock({ path: ctx.lockPath, timeoutMs: 2000 }, () => Promise.resolve('first'));

  const result = await withFileLock({ path: ctx.lockPath, timeoutMs: 100 }, () =>
    Promise.resolve('second'),
  );

  expect(result).toBe('second');
});

test('it takes over a lock whose owner has died', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'stale.lock');

  await writeFile(path, formatLockOwner({ pid: dead, namespace: ctx.namespace, token: 'owner' }));

  const result = await withFileLock({ path, timeoutMs: 1000 }, () => Promise.resolve('held'));

  expect(result).toBe('held');
});

test('it leaves the lock of an owner in another PID namespace in place', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'foreign.lock');

  await writeFile(path, formatLockOwner({ pid: dead, namespace: 'elsewhere', token: 'owner' }));

  expect(
    withFileLock({ path, timeoutMs: 100 }, () => Promise.resolve('held')),
  ).rejects.toMatchObject({ code: 'environment' });
});

test('it lets one of many callers at a time past a dead owner’s lock', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'stale.lock');

  await writeFile(path, formatLockOwner({ pid: dead, namespace: ctx.namespace, token: 'owner' }));

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

test('it removes the claim of a caller that died while it held the claim', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'stale.lock');
  const stale = formatLockOwner({ pid: dead, namespace: ctx.namespace, token: 'owner' });

  await writeFile(path, stale);

  await writeFile(
    ctx.claimPathOf(path, stale),
    formatLockOwner({ pid: dead, namespace: ctx.namespace, token: 'claimant' }),
  );

  const result = await withFileLock({ path, timeoutMs: 1000 }, () => Promise.resolve('held'));

  expect(result).toBe('held');
});

test('it leaves the claim of a live caller in place, however old', async () => {
  const ctx = await setupTest();

  const dead = Bun.spawnSync(['true']).pid;
  const path = join(ctx.directory, 'stale.lock');
  const stale = formatLockOwner({ pid: dead, namespace: ctx.namespace, token: 'owner' });

  await writeFile(path, stale);

  await writeFile(
    ctx.claimPathOf(path, stale),
    formatLockOwner({ pid: process.pid, namespace: ctx.namespace, token: 'claimant' }),
  );

  expect(
    withFileLock({ path, timeoutMs: 100 }, () => Promise.resolve('held')),
  ).rejects.toMatchObject({ code: 'environment' });
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

  const path = join(ctx.directory, 'live.lock');

  await writeFile(
    path,
    formatLockOwner({ pid: process.pid, namespace: ctx.namespace, token: 'owner' }),
  );

  expect(
    withFileLock({ path, timeoutMs: 50 }, () => Promise.resolve('held')),
  ).rejects.toMatchObject({ code: 'environment' });
});
