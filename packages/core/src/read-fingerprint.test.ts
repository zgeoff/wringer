import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyFingerprint, readFingerprint } from './read-fingerprint.ts';
import { runGit } from './run-git.ts';

async function setupTest() {
  const repo = await mkdtemp(join(import.meta.dir, '.test-read-fingerprint-'));

  onTestFinished(() => rm(repo, { recursive: true, force: true }));

  await runGit({ cwd: repo, args: ['init', '--quiet', '--initial-branch=main'] });
  await runGit({ cwd: repo, args: ['config', 'user.email', 'tester@example.com'] });
  await runGit({ cwd: repo, args: ['config', 'user.name', 'Tester'] });
  await runGit({ cwd: repo, args: ['config', 'commit.gpgsign', 'false'] });

  return {
    repo,
    git: (...args: readonly string[]) => runGit({ cwd: repo, args }),
    readFingerprint: () => readFingerprint({ cwd: repo, base: 'main', exclude: ['.wringer'] }),
  };
}

test('it gives the same fingerprint before and after the work is committed', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');
  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = true;\n');

  const before = await ctx.readFingerprint();

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'work');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint after a clean rebase onto a moved base', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');
  await writeFile(join(ctx.repo, 'other.ts'), 'export const other = 1;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  await ctx.git('commit', '--quiet', '-am', 'work');

  const before = await ctx.readFingerprint();

  await ctx.git('switch', '--quiet', 'main');

  await writeFile(join(ctx.repo, 'other.ts'), 'export const other = 2;\n');

  await ctx.git('commit', '--quiet', '-am', 'moved on');
  await ctx.git('switch', '--quiet', 'feature');
  await ctx.git('rebase', '--quiet', 'main');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it changes the fingerprint when an untracked file changes', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 1;\n');

  const before = await ctx.readFingerprint();

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 2;\n');

  const after = await ctx.readFingerprint();

  expect(after).not.toBe(before);
});

test('it leaves the evidence folder out of the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it reads the fingerprint of a repo that ignores the evidence folder', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitignore'), '.wringer/\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it leaves a committed change to the evidence folder out of the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'notes.md'), 'checked by hand\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'notes');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it gives two calls at once the same fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const fingerprints = await Promise.all([ctx.readFingerprint(), ctx.readFingerprint()]);

  expect(new Set(fingerprints).size).toBe(1);
});

test('it leaves the real index untouched', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 1;\n');

  await ctx.readFingerprint();

  const status = await ctx.git('status', '--porcelain');

  expect(status.stdout).toBe('?? new.ts\n');
});
