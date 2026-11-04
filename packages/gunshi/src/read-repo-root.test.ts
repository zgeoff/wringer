import { expect, onTestFinished, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';
import { readRepoRoot } from './read-repo-root.ts';

test('it reads the top of the worktree from a folder inside it', async () => {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  await mkdir(join(repo.root, 'src', 'cart'), { recursive: true });

  const root = await readRepoRoot(join(repo.root, 'src', 'cart'));

  expect(root).toBe(repo.root);
});

test('it answers an environment error outside a git worktree', async () => {
  const root = await readRepoRoot('/');

  expect(root).toMatchObject({ code: 'environment' });
});
