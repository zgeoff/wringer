import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '../change-facts/run-git.ts';

// Commits a cart feature, a checkout feature, a shared package.json and a README to the repo's
// current branch. The repo must already have a git author set.
export async function seedShopRepo(repo: string): Promise<void> {
  await mkdir(join(repo, 'src', 'cart'), { recursive: true });
  await mkdir(join(repo, 'src', 'checkout'), { recursive: true });
  await writeFile(join(repo, 'src', 'cart', 'add.ts'), 'export const add = 1;\n');
  await writeFile(join(repo, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');
  await writeFile(join(repo, 'package.json'), '{}\n');
  await writeFile(join(repo, 'README.md'), '# shop\n');
  await runGit({ cwd: repo, args: ['add', '.'] });
  await runGit({ cwd: repo, args: ['commit', '--quiet', '-m', 'start'] });
}
