import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { buildSubmoduleAdds } from './build-submodule-adds.ts';
import type { GitRequest } from './run-git.ts';
import type { ProcessResult } from './run-process.ts';

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

// The patch ID hashes every line of the diff, so each git setting that shapes the diff is pinned,
// and the same change gets the same fingerprint in any clone.
const pinnedDiffConfig = ['-c', 'diff.suppressBlankEmpty=false', '-c', 'core.quotePath=true'];

const pinnedDiffOptions = [
  '--unified=3',
  '--inter-hunk-context=0',
  '--no-renames',
  '--diff-algorithm=myers',
  '--indent-heuristic',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--ignore-submodules=none',
  '--submodule=short',
];

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

  // git lets GIT_DIFF_OPTS override `--unified`, and the pathspec variables change what `:(top)` and
  // each exclusion match, so a caller's values would change the diff.
  const env = {
    GIT_INDEX_FILE: indexPath,
    GIT_DIFF_OPTS: '--unified=3',
    GIT_LITERAL_PATHSPECS: '0',
    GIT_GLOB_PATHSPECS: '0',
    GIT_NOGLOB_PATHSPECS: '0',
    GIT_ICASE_PATHSPECS: '0',
  };

  try {
    // The temporary index starts as a copy of the repo's own, so a file staged past an ignore rule
    // counts as a commit would count it. `--index-info` takes the lines `ls-files --stage` prints.
    const staged = await host.runGit({ cwd: request.cwd, args: ['ls-files', '--stage', '-z'] });

    await host.runGit({
      cwd: request.cwd,
      args: ['update-index', '-z', '--index-info'],
      stdin: staged.stdout,
      env,
    });

    await host.runGit({ cwd: request.cwd, args: ['add', '--all'], env });

    await addSubmodules(host, request.cwd, env);

    // The exclusions apply to the diff, not to `add`: `add` refuses an ignored path in a pathspec,
    // and a committed change to an excluded path reaches the index from the repo's own anyway. The
    // root pathspecs and `--no-relative` make a call from a subfolder see the whole tree.
    const diff = await host.runGit({
      cwd: request.cwd,
      args: [
        ...pinnedDiffConfig,
        'diff',
        '--cached',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-relative',
        ...pinnedDiffOptions,
        mergeBase,
        '--',
        ':(top)',
        ...request.exclude.map((path) => `:(top,exclude)${path}`),
      ],
      env,
    });

    const patchID = await host.runGit({
      cwd: request.cwd,

      // `--verbatim` hashes with the stable algorithm and keeps whitespace, so `"a b"` and `"ab"`
      // differ; `--stable` alone drops it, and git refuses the two flags together.
      args: ['patch-id', '--verbatim'],
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

async function addSubmodules(
  host: FingerprintHost,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const staged = await host.runGit({ cwd, args: ['ls-files', '--stage', '-z'], env });

  for (const request of buildSubmoduleAdds({ cwd, env, stagedEntries: staged.stdout })) {
    await host.runGit(request);
  }
}
