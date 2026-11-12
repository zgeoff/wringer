import type { ChangeRequest } from './build-change-request.ts';
import { isGlobMatch } from './is-glob-match.ts';
import type { FingerprintHost } from './read-fingerprint.ts';

// The paths the branch changes against its merge base: committed, staged and unstaged edits, and
// untracked files that git does not ignore. A path an ignore glob matches is left out.
export async function readChangedPaths(
  host: Pick<FingerprintHost, 'runGit' | 'runGitBytes'>,
  request: ChangeRequest,
): Promise<readonly string[]> {
  const mergeBaseResult = await host.runGit({
    cwd: request.cwd,
    args: ['merge-base', 'HEAD', request.base],
  });

  const mergeBase = mergeBaseResult.stdout.trim();
  const excludes = request.exclude.map((path) => `:(exclude)${path}`);

  // `-z` gives each path as it is: without it, git quotes a path with a tab, a newline or a
  // non-ASCII letter, and the quoted form matches no feature's glob. Each path is decoded on its
  // own, as the fingerprint decodes it, so a leading byte-order mark stays part of the name.
  const [tracked, untracked] = await Promise.all([
    host.runGitBytes({
      cwd: request.cwd,
      args: ['diff', '--name-only', '-z', '--no-renames', mergeBase, '--', '.', ...excludes],
    }),
    host.runGitBytes({
      cwd: request.cwd,
      args: ['ls-files', '-z', '--others', '--exclude-standard', '--', '.', ...excludes],
    }),
  ]);

  const paths = [...splitNames(tracked), ...splitNames(untracked)].filter(
    (path) => !isGlobMatch(path, request.ignore),
  );

  return [...new Set(paths)].toSorted();
}

function splitNames(output: Uint8Array): readonly string[] {
  const names: string[] = [];
  const bytes = Buffer.from(output);
  let start = 0;

  while (start < bytes.length) {
    const end = bytes.indexOf(0, start);
    const stop = end === -1 ? bytes.length : end;

    if (stop > start) {
      names.push(bytes.subarray(start, stop).toString('utf8'));
    }

    start = stop + 1;
  }

  return names;
}
