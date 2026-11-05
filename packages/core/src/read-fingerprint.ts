import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { GitRequest } from './run-git.ts';
import type { ProcessResult } from './run-process.ts';

// The fingerprint's view of git and the disk.
export interface FingerprintHost {
  readonly runGit: (request: GitRequest) => Promise<ProcessResult>;
  readonly removeFile: (path: string) => Promise<void>;
}

export interface FingerprintRequest {
  readonly cwd: string;
  readonly base: string;
  readonly exclude: readonly string[];
}

export const emptyFingerprint = 'empty';

// The fingerprint is `git patch-id --stable` of the working tree against the merge base. A commit
// leaves the diff against the merge base as it was, and a clean rebase moves both ends of it, so
// neither changes the fingerprint. Untracked files join the diff through a temporary index.
export async function readFingerprint(
  host: FingerprintHost,
  request: FingerprintRequest,
): Promise<string> {
  const mergeBaseResult = await host.runGit({
    cwd: request.cwd,
    args: ['merge-base', 'HEAD', request.base],
  });

  const mergeBase = mergeBaseResult.stdout.trim();

  const indexPath = await readTemporaryIndexPath(host, request.cwd);

  const env = { GIT_INDEX_FILE: indexPath };

  try {
    await host.runGit({ cwd: request.cwd, args: ['read-tree', 'HEAD'], env });
    await host.runGit({ cwd: request.cwd, args: ['add', '--all'], env });

    // The exclusions apply to the diff, not to `add`: `add` refuses an ignored path in a pathspec,
    // and a committed change to an excluded path reaches the index through `read-tree` anyway. The
    // root pathspecs and `--no-relative` make a call from a subfolder see the whole tree.
    const diff = await host.runGit({
      cwd: request.cwd,
      args: [
        'diff',
        '--cached',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-relative',
        mergeBase,
        '--',
        ':(top)',
        ...request.exclude.map((path) => `:(top,exclude)${path}`),
      ],
      env,
    });

    const patchID = await host.runGit({
      cwd: request.cwd,
      args: ['patch-id', '--stable'],
      stdin: diff.stdout,
    });

    const [fingerprint = ''] = patchID.stdout.trim().split(' ');

    return fingerprint === '' ? emptyFingerprint : fingerprint;
  } finally {
    await host.removeFile(indexPath);
  }
}

// git resolves a relative GIT_INDEX_FILE against the folder it runs in, so a path built on a
// relative `cwd` would take that `cwd` twice. The path goes to git absolute.
async function readTemporaryIndexPath(host: FingerprintHost, cwd: string): Promise<string> {
  const result = await host.runGit({
    cwd,
    args: ['rev-parse', '--git-path', `wringer-index-${randomUUID()}`],
  });

  return resolve(cwd, result.stdout.trim());
}
