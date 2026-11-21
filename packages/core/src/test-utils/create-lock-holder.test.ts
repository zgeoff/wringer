import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { createTempDir } from '@zgeoff/testing/fs';
import { createLockHolder } from './create-lock-holder.ts';

function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = createTempDir('create-lock-holder').path;

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
  const ctx = setupTest();

  const holder = await ctx.holdLock();
  const result = await ctx.tryLock();

  expect({ held: holder.held, kind: result.kind }).toStrictEqual({ held: true, kind: 'busy' });
});

test('it frees the lock once it is killed', async () => {
  const ctx = setupTest();

  const holder = await ctx.holdLock();

  await holder.kill();

  expect(ctx.tryLock()).resolves.toStrictEqual({ kind: 'ran', value: 'took' });
});
