import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '../src/run-git.ts';

export interface TestRepo {
  readonly root: string;
  readonly git: (...args: readonly string[]) => Promise<string>;
  readonly remove: () => Promise<void>;
}

// A git repo on `main` with one commit and `.wringer/` ignored. The caller removes it, after it has
// stopped whatever still writes into it.
export async function createTestRepo(parent: string): Promise<TestRepo> {
  const root = await mkdtemp(join(parent, '.test-repo-'));

  const git = async (...args: readonly string[]): Promise<string> => {
    const result = await runGit({ cwd: root, args });

    return result.stdout;
  };

  await git('init', '--quiet', '--initial-branch=main');
  await git('config', 'user.email', 'tester@example.com');
  await git('config', 'user.name', 'Tester');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(root, '.gitignore'), '.wringer/\n');
  await writeFile(join(root, 'README.md'), '# shop\n');
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'start');

  return { root, git, remove: () => rm(root, { recursive: true, force: true }) };
}
