import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { runGit } from './run-git.ts';

export interface FingerprintRequest {
  readonly cwd: string;
  readonly base: string;
  readonly exclude: readonly string[];
}

export const emptyFingerprint = 'empty';

// The fingerprint is `git patch-id --stable` of the working tree against the merge base. A commit
// leaves the diff against the merge base as it was, and a clean rebase moves both ends of it, so
// neither changes the fingerprint. Untracked files join the diff through a temporary index.
export async function readFingerprint(request: FingerprintRequest): Promise<string> {
  const mergeBaseResult = await runGit({
    cwd: request.cwd,
    args: ['merge-base', 'HEAD', request.base],
  });

  const mergeBase = mergeBaseResult.stdout.trim();

  const indexPath = await readTemporaryIndexPath(request.cwd);

  const env = { GIT_INDEX_FILE: indexPath };

  try {
    await runGit({ cwd: request.cwd, args: ['read-tree', 'HEAD'], env });
    await runGit({ cwd: request.cwd, args: ['add', '--all'], env });

    // The exclusions apply to the diff, not to `add`: `add` refuses an ignored path in a pathspec,
    // and a committed change to an excluded path reaches the index through `read-tree` anyway. The
    // pathspecs start at the repo root, so a call from a subfolder sees the whole tree.
    const diff = await runGit({
      cwd: request.cwd,
      args: [
        'diff',
        '--cached',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        mergeBase,
        '--',
        ':(top)',
        ...request.exclude.map((path) => `:(top,exclude)${path}`),
      ],
      env,
    });

    const patchID = await runGit({
      cwd: request.cwd,
      args: ['patch-id', '--stable'],
      stdin: diff.stdout,
    });

    const [fingerprint = ''] = patchID.stdout.trim().split(' ');

    return fingerprint === '' ? emptyFingerprint : fingerprint;
  } finally {
    await rm(indexPath, { force: true });
  }
}

async function readTemporaryIndexPath(cwd: string): Promise<string> {
  const result = await runGit({
    cwd,
    args: ['rev-parse', '--git-path', `wringer-index-${randomUUID()}`],
  });

  const gitPath = result.stdout.trim();

  return isAbsolute(gitPath) ? gitPath : join(cwd, gitPath);
}
