import { expect, onTestFinished, test } from 'bun:test';
import { createTestRepo } from './create-test-repo.ts';

test('it creates a repo on main with one commit that ignores the state folder', async () => {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const [branch, commits, ignored] = await Promise.all([
    repo.git('branch', '--show-current'),
    repo.git('rev-list', '--count', 'HEAD'),
    repo.git('check-ignore', '.wringer/runs'),
  ]);

  expect({ branch, commits, ignored }).toStrictEqual({
    branch: 'main\n',
    commits: '1\n',
    ignored: '.wringer/runs\n',
  });
});
