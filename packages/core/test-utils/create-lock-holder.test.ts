import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createLockHolder } from './create-lock-holder.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'create-lock-holder');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const lockPath = join(directory, 'locks', 'shelf.lock');

  return {
    holdLock: async () => {
      const holder = await createLockHolder(lockPath);

      stack.defer(holder.kill);

      return holder;
    },
    tryLock: () => withFileLock(lockPath, () => Promise.resolve('took'), { waitMs: 50 }),
  };
}

test('it keeps the lock from this process while it runs', async () => {
  const ctx = await setupTest();
  const holder = await ctx.holdLock();
  const result = await ctx.tryLock();

  expect({ held: holder.held, kind: result.kind }).toStrictEqual({ held: true, kind: 'busy' });
});

test('it frees the lock once it is killed', async () => {
  const ctx = await setupTest();
  const holder = await ctx.holdLock();

  await holder.kill();

  expect(ctx.tryLock()).resolves.toStrictEqual({ kind: 'ran', value: 'took' });
});
