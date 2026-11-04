import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { readHeadSHA } from './read-head-sha.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  return { repo };
}

test('it reads the short SHA of the head commit', async () => {
  const ctx = await setupTest();
  const head = await ctx.repo.git('rev-parse', '--short', 'HEAD');
  const sha = await readHeadSHA(ctx.repo.root);

  expect(sha).toBe(head.trim());
});

test('it reads no SHA when git cannot start in a missing folder', async () => {
  const ctx = await setupTest();
  const sha = await readHeadSHA(join(ctx.repo.root, 'missing'));

  expect(sha).toBeNull();
});
