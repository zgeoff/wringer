import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { readChangedPaths } from './read-changed-paths.ts';
import { runGit } from './run-git.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  return {
    root: repo.root,
    git: repo.git,
    readChangedPaths: () =>
      readChangedPaths({ runGit }, { cwd: repo.root, base: 'main', exclude: ['.wringer'] }),
  };
}

test('it lists committed, edited and untracked paths against the merge base', async () => {
  const ctx = await setupTest();

  await ctx.git('switch', '--quiet', '-c', 'feature');

  await mkdir(join(ctx.root, 'src'));
  await writeFile(join(ctx.root, 'src', 'cart.ts'), 'export const cart = [];\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'cart');

  await writeFile(join(ctx.root, 'README.md'), '# shop, edited\n');
  await writeFile(join(ctx.root, 'src', 'pay.ts'), 'export const pay = 1;\n');

  const paths = await ctx.readChangedPaths();

  expect(paths).toStrictEqual(['README.md', 'src/cart.ts', 'src/pay.ts']);
});

test('it lists a path with non-ASCII letters as it is, not quoted', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, 'src'));
  await writeFile(join(ctx.root, 'src', 'café.ts'), 'export const menu = [];\n');

  await ctx.git('add', '.');

  const paths = await ctx.readChangedPaths();

  expect(paths).toStrictEqual(['src/café.ts']);
});

test('it leaves the evidence folder out', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.root, '.wringer'));
  await writeFile(join(ctx.root, '.wringer', 'state.json'), '{}\n');

  await ctx.git('add', '--force', '.wringer/state.json');

  const paths = await ctx.readChangedPaths();

  expect(paths).toStrictEqual([]);
});
