import { runGit } from './run-git.ts';

export interface ChangedPathsRequest {
  readonly cwd: string;
  readonly base: string;
  readonly exclude: readonly string[];
}

// The paths the branch changes against its merge base: committed, staged and unstaged edits, and
// untracked files that git does not ignore.
export async function readChangedPaths(request: ChangedPathsRequest): Promise<readonly string[]> {
  const mergeBaseResult = await runGit({
    cwd: request.cwd,
    args: ['merge-base', 'HEAD', request.base],
  });

  const mergeBase = mergeBaseResult.stdout.trim();
  const excludes = request.exclude.map((path) => `:(exclude)${path}`);

  const [tracked, untracked] = await Promise.all([
    runGit({
      cwd: request.cwd,
      args: ['diff', '--name-only', '--no-renames', mergeBase, '--', '.', ...excludes],
    }),
    runGit({
      cwd: request.cwd,
      args: ['ls-files', '--others', '--exclude-standard', '--', '.', ...excludes],
    }),
  ]);

  const paths = `${tracked.stdout}\n${untracked.stdout}`.split('\n').filter((path) => path !== '');

  return [...new Set(paths)].toSorted();
}
