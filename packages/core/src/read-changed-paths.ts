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

  // `-z` gives each path as it is: without it, git quotes a path with a tab, a newline or a
  // non-ASCII letter, and the quoted form matches no feature's glob.
  const [tracked, untracked] = await Promise.all([
    runGit({
      cwd: request.cwd,
      args: ['diff', '--name-only', '-z', '--no-renames', mergeBase, '--', '.', ...excludes],
    }),
    runGit({
      cwd: request.cwd,
      args: ['ls-files', '-z', '--others', '--exclude-standard', '--', '.', ...excludes],
    }),
  ]);

  const paths = `${tracked.stdout}\0${untracked.stdout}`.split('\0').filter((path) => path !== '');

  return [...new Set(paths)].toSorted();
}
