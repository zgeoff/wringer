import { expect, onTestFinished, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '@wringer/core';
import { createTestRepo } from '@wringer/core/test-utils/create-test-repo.ts';
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

test('it keeps the trailing space of a worktree folder name', async () => {
  const ctx = await setupTest();

  const shop = join(ctx.root, 'shop ');

  await runProcess({ argv: ['git', 'init', '--quiet', shop], cwd: ctx.root });

  const root = await ctx.readRepoRoot(shop);

  expect(root).toBe(shop);
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
