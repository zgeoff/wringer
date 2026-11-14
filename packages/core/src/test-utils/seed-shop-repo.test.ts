import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { runGit } from '../change-facts/run-git.ts';
import { createTestFolder } from './create-test-folder.ts';
import { seedShopRepo } from './seed-shop-repo.ts';

async function setupTest() {
  const repo = await createTestFolder(import.meta.dir, 'seed-shop-repo');

  onTestFinished(() => rm(repo, { recursive: true, force: true }));

  await runGit({ cwd: repo, args: ['init', '--quiet', '--initial-branch=main'] });
  await runGit({ cwd: repo, args: ['config', 'user.email', 'tester@example.com'] });
  await runGit({ cwd: repo, args: ['config', 'user.name', 'Tester'] });
  await runGit({ cwd: repo, args: ['config', 'commit.gpgsign', 'false'] });

  return {
    repo,
    readCommits: async () => {
      const log = await runGit({ cwd: repo, args: ['log', '--format=%s'] });
      const files = await runGit({ cwd: repo, args: ['ls-files'] });
      const status = await runGit({ cwd: repo, args: ['status', '--porcelain'] });

      return {
        subjects: log.stdout.trim().split('\n'),
        files: files.stdout.trim().split('\n'),
        clean: status.stdout === '',
      };
    },
  };
}

test('it commits the shop files in one commit and leaves the tree clean', async () => {
  const ctx = await setupTest();

  await seedShopRepo(ctx.repo);

  const commits = await ctx.readCommits();

  expect(commits).toStrictEqual({
    subjects: ['start'],
    files: ['README.md', 'package.json', 'src/cart/add.ts', 'src/checkout/pay.ts'],
    clean: true,
  });
});
