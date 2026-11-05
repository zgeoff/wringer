import { expect, onTestFinished, test } from 'bun:test';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { readDefaultBase } from './read-default-base.ts';
import { runGit } from './run-git.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  return { git: repo.git, readDefaultBase: () => readDefaultBase({ runGit }, repo.root) };
}

test('it reads the remote default branch when the clone knows it', async () => {
  const ctx = await setupTest();

  await ctx.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');

  const base = await ctx.readDefaultBase();

  expect(base).toBe('origin/trunk');
});

test('it falls back to main when the clone has no remote default branch', async () => {
  const ctx = await setupTest();
  const base = await ctx.readDefaultBase();

  expect(base).toBe('main');
});
