import { expect, onTestFinished, test } from 'bun:test';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '../change-facts/run-git.ts';
import { createTestRepo } from './create-test-repo.ts';
import { seedImportWorkspace } from './seed-import-workspace.ts';

test('it commits the workspace and links lib into node_modules without committing the link', async () => {
  const repo = await createTestRepo();

  onTestFinished(() => {
    repo.remove();
  });

  await seedImportWorkspace(repo.root);

  const listed = await runGit({ cwd: repo.root, args: ['ls-files'] });
  const link = await lstat(join(repo.root, 'node_modules', '@fx', 'lib'));

  expect({
    link: link.isSymbolicLink(),
    tracked: listed.stdout.includes('node_modules'),
  }).toStrictEqual({ link: true, tracked: false });
});
