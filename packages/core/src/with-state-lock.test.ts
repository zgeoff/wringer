import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { withStateLock } from './with-state-lock.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'with-state-lock');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    lockPath: join(directory, 'locks', 'target-local.lock'),

    // A separate process takes the lock and keeps it until the test kills it.
    holdInOtherProcess: async (path: string) => {
      await mkdir(dirname(path), { recursive: true });

      const script = [
        "import { withFileLock } from '@zgeoff/std/with-file-lock';",
        `await withFileLock(${JSON.stringify(path)}, async () => {`,
        "  console.log('held');",
        '  await Bun.sleep(60_000);',
        '});',
      ].join('\n');

      const holder = Bun.spawn([process.execPath, '-e', script], {
        cwd: join(import.meta.dir, '..'),
        stdout: 'pipe',
      });

      onTestFinished(() => {
        holder.kill('SIGKILL');
      });

      const reader = holder.stdout.getReader();

      const first = await reader.read();

      return { holder, held: !first.done };
    },
  };
}

test('it runs the work in a folder it creates and returns the work value', async () => {
  const ctx = await setupTest();
  const value = await withStateLock(ctx.lockPath, 2000, () => Promise.resolve('stocked'));

  expect(value).toBe('stocked');
});

test('it keeps a second caller out with an environment error while the first holds the lock', async () => {
  const ctx = await setupTest();

  const firstIn = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();

  const firstHolder = withStateLock(ctx.lockPath, 2000, async () => {
    firstIn.resolve(undefined);

    await release.promise;
  });

  onTestFinished(async () => {
    release.resolve(undefined);

    await firstHolder;
  });

  await firstIn.promise;

  expect(withStateLock(ctx.lockPath, 50, () => Promise.resolve('second in'))).rejects.toMatchObject(
    { code: 'environment' },
  );
});

test('it lets the next caller in once the first holder is done', async () => {
  const ctx = await setupTest();

  await withStateLock(ctx.lockPath, 2000, () => Promise.resolve('first'));

  expect(withStateLock(ctx.lockPath, 0, () => Promise.resolve('second'))).resolves.toBe('second');
});

test('it lets a caller in once the process that held the lock is killed', async () => {
  const ctx = await setupTest();
  const holding = await ctx.holdInOtherProcess(ctx.lockPath);

  holding.holder.kill('SIGKILL');

  await holding.holder.exited;

  const entering = withStateLock(ctx.lockPath, 2000, () => Promise.resolve('after'));

  const [after] = await Promise.allSettled([entering]);

  expect({ held: holding.held, after }).toStrictEqual({
    held: true,
    after: { status: 'fulfilled', value: 'after' },
  });
});

test('it keeps a caller out while a live process holds the lock', async () => {
  const ctx = await setupTest();
  const holding = await ctx.holdInOtherProcess(ctx.lockPath);

  const entering = withStateLock(ctx.lockPath, 50, () => Promise.resolve('in'));

  const [entered] = await Promise.allSettled([entering]);

  expect({ held: holding.held, entered }).toStrictEqual({
    held: true,
    entered: { status: 'rejected', reason: expect.objectContaining({ code: 'environment' }) },
  });
});
