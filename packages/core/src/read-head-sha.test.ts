import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { readHeadSHA } from './read-head-sha.ts';
import { runGit } from './run-git.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  return { repo, readHeadSHA: (root: string) => readHeadSHA({ runGit }, root) };
}

test('it reads the short SHA of the head commit', async () => {
  const ctx = await setupTest();
  const head = await ctx.repo.git('rev-parse', '--short', 'HEAD');
  const sha = await ctx.readHeadSHA(ctx.repo.root);

  expect(sha).toBe(head.trim());
});

test('it reads no SHA when git cannot start in a missing folder', async () => {
  const ctx = await setupTest();
  const sha = await ctx.readHeadSHA(join(ctx.repo.root, 'missing'));

  expect(sha).toBeNull();
});

test('it reads no SHA in a repo with no commit yet', async () => {
  const ctx = await setupTest();

  await ctx.repo.git('checkout', '--quiet', '--orphan', 'empty');

  const sha = await ctx.readHeadSHA(ctx.repo.root);

  expect(sha).toBeNull();
});
