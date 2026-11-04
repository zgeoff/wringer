import { expect, onTestFinished, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';
import { readRepoRoot } from './read-repo-root.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  return { root: repo.root, readRepoRoot };
}

test('it reads the top of the worktree from a folder inside it', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src', 'cart'), { recursive: true });

  const root = await ctx.readRepoRoot(join(ctx.root, 'src', 'cart'));

  expect(root).toBe(ctx.root);
});

test('it answers an environment error outside a git worktree', async () => {
  const ctx = await setupTest();
  const root = await ctx.readRepoRoot('/');

  expect(root).toMatchObject({ code: 'environment' });
});

test('it answers an environment error for a folder that does not exist', async () => {
  const ctx = await setupTest();
  const root = await ctx.readRepoRoot(join(ctx.root, 'missing'));

  expect(root).toMatchObject({ code: 'environment' });
});
