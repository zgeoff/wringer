import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { runGit } from '../change-facts/run-git.ts';

export interface TestRepo {
  readonly root: string;
  readonly git: (...args: readonly string[]) => Promise<string>;
  readonly remove: () => void;
}

// A git repo on `main` with one commit and `.wringer/` ignored. The caller removes it, after it has
// stopped whatever still writes into it.
export async function createTestRepo(): Promise<TestRepo> {
  const folder = createTempDir('repo', { cleanup: 'manual' });
  const root = folder.path;

  const git = async (...args: readonly string[]): Promise<string> => {
    const result = await runGit({ cwd: root, args });

    return result.stdout;
  };

  // Late work from a timed-out command can add or remove files while the removal walks the tree, so
  // the kit's removal repeats until the folder is gone.
  const remove = folder.remove;

  // The caller gets `remove` only once this returns, so a failed step removes the folder here.
  try {
    await git('init', '--quiet', '--initial-branch=main');
    await git('config', 'user.email', 'tester@example.com');
    await git('config', 'user.name', 'Tester');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(root, '.gitignore'), '.wringer/\n');
    await writeFile(join(root, 'README.md'), '# shop\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'start');
  } catch (error) {
    remove();
    throw error;
  }

  return { root, git, remove };
}
