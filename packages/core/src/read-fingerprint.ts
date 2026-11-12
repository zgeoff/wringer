import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { ChangeRequest } from './build-change-request.ts';
import { buildPromisedObjectReads } from './build-promised-object-reads.ts';
import { buildSkipWorktreeMarks } from './build-skip-worktree-marks.ts';
import { buildSubmoduleAdds } from './build-submodule-adds.ts';
import { isGlobMatch } from './is-glob-match.ts';
import { parsePatchID } from './parse-patch-id.ts';
import { pickMergeBaseFailure } from './pick-merge-base-failure.ts';
import { pickMergeBaseSteps } from './pick-merge-base-steps.ts';
import { pickSubmoduleRefusal } from './pick-submodule-refusal.ts';
import type { GitRequest } from './run-git.ts';
import type { ProcessResult } from './run-process.ts';
import { WringerError } from './wringer-error.ts';

export interface FingerprintHost {
  readonly runGit: (request: GitRequest) => Promise<ProcessResult>;
  readonly runGitBytes: (request: GitRequest) => Promise<Uint8Array>;
  readonly removeDirectory: (path: string) => Promise<void>;
}

// `ignore` holds globs of paths with no runtime effect: a change to a path one matches leaves the
// fingerprint alone.
export type FingerprintRequest = ChangeRequest;

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

// The index is built and diffed in a git folder of its own, so only the repo's tracked files and
// git's defaults shape the change: no config, attributes or ignore rules of the clone, the user or
// the system reach it, and the same change gets the same fingerprint in any clone.
export async function readFingerprint(
  host: FingerprintHost,
  request: FingerprintRequest,
): Promise<string> {
  const root = await readRepoRoot(host, request.cwd);
  const mergeBase = await readMergeBase(host, root, request.base);

  await readPromisedObjects(host, root, mergeBase);
  await readSubmoduleWork(host, root);

  const gitDir = await readGitPath(host, root, `wringer-${randomUUID()}`);

  try {
    const env = await createIsolatedGitDir(host, root, gitDir);

    // The index starts as a copy of the repo's own, so a file staged past an ignore rule counts as
    // a commit would count it. `--index-info` takes the lines `ls-files --stage` prints.
    const staged = await host.runGitBytes({ cwd: root, args: ['ls-files', '--stage', '-z'] });

    await host.runGit({
      cwd: root,
      args: ['update-index', '-z', '--index-info'],
      stdin: staged,
      env,
    });

    await copySkipWorktreeFlags(host, root, env);

    // With sparse checkout on, git 2.37 and later clears the skip-worktree mark of each file on disk
    // as it reads the index, so an edit to a marked file counts and only an absent one stays out.
    await host.runGit({
      cwd: root,
      args: ['-c', 'core.sparseCheckout=true', 'add', '--all'],
      env,
    });

    await addSubmodules(host, root, env);
    await restoreIgnoredPaths(host, { root, env, mergeBase, ignore: request.ignore });

    // The exclusions apply to the diff, not to `add`: `add` refuses an ignored path in a pathspec,
    // and a committed change to an excluded path reaches the index from the repo's own anyway.
    const diff = await host.runGitBytes({
      cwd: root,
      args: [
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
      cwd: root,

      // `--verbatim` hashes with the stable algorithm and keeps whitespace, so `"a b"` and `"ab"`
      // differ; `--stable` alone drops it, and git refuses the two flags together.
      args: ['patch-id', '--verbatim'],
      stdin: diff,
      env,
    });

    return parsePatchID(patchID.stdout);
  } finally {
    await host.removeDirectory(gitDir);
  }
}

// From a subfolder, `ls-files` lists only that folder, with paths relative to it, so every index
// step runs from the root.
async function readRepoRoot(host: FingerprintHost, cwd: string): Promise<string> {
  const result = await host.runGit({ cwd, args: ['rev-parse', '--show-toplevel'] });

  // A folder name may end in a space, so only the line end git adds comes off.
  return resolve(cwd, result.stdout.replace(/\n$/u, ''));
}

async function readMergeBase(host: FingerprintHost, root: string, base: string): Promise<string> {
  const commits = await host.runGit({ cwd: root, args: ['rev-list', '--max-count=1', '--all'] });

  const steps = pickMergeBaseSteps({ root, base, newestCommit: commits.stdout });

  if (steps instanceof WringerError) {
    throw steps;
  }

  await host.runGit(steps.verifyBase);

  try {
    const result = await host.runGit(steps.mergeBase);

    return result.stdout.trim();
  } catch (error) {
    throw pickMergeBaseFailure(error, steps.noSharedCommit);
  }
}

async function readPromisedObjects(
  host: FingerprintHost,
  root: string,
  mergeBase: string,
): Promise<void> {
  const config = await host.runGit({ cwd: root, args: ['config', '--list', '-z'] });

  for (const request of buildPromisedObjectReads({ root, mergeBase, configList: config.stdout })) {
    await host.runGit(request);
  }
}

// `--no-optional-locks` keeps status from writing the repo's own index, and `-uno` skips the
// repo's own untracked files, which `add --all` counts anyway.
async function readSubmoduleWork(host: FingerprintHost, root: string): Promise<void> {
  const status = await host.runGitBytes({
    cwd: root,
    args: [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '-z',
      '--ignore-submodules=none',
      '--untracked-files=no',
    ],
  });

  const refusal = pickSubmoduleRefusal(status);

  if (refusal !== null) {
    throw refusal;
  }
}

// git prints a path inside the git folder relative to the folder it runs in; the path leaves here
// absolute.
async function readGitPath(host: FingerprintHost, root: string, name: string): Promise<string> {
  const result = await host.runGit({ cwd: root, args: ['rev-parse', '--git-path', name] });

  return resolve(root, result.stdout.replace(/\n$/u, ''));
}

// Only git's defaults apply: no system or global config, and no `-c` from a calling git. The two
// keys turn off the attributes and ignore files git reads from the user's config folder by default.
const isolatedConfigEnv = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_PARAMETERS: '',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.attributesFile',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.excludesFile',
  GIT_CONFIG_VALUE_1: '/dev/null',
  GIT_ATTR_NOSYSTEM: '1',
};

// The folder reads the repo's objects as alternates and writes its own, so the repo gains no
// object. A bare folder made with no template has no `info/attributes` and no `info/exclude`.
async function createIsolatedGitDir(
  host: FingerprintHost,
  root: string,
  gitDir: string,
): Promise<Readonly<Record<string, string>>> {
  const objects = await readGitPath(host, root, 'objects');
  const format = await host.runGit({ cwd: root, args: ['rev-parse', '--show-object-format'] });

  await host.runGit({
    cwd: root,
    args: ['init', '--quiet', '--bare', '--template=', `--object-format=${format.stdout.trim()}`],
    env: { ...isolatedConfigEnv, GIT_DIR: gitDir, GIT_COMMON_DIR: gitDir },
  });

  return buildIsolatedEnv(gitDir, root, objects);
}

// Each variable a calling git, such as a hook's, may set is overwritten, so the steps cannot reach
// the repo's own index, objects or git folder. git lets GIT_DIFF_OPTS override `--unified`, and
// the pathspec variables change what `:(top)` and each exclusion match.
function buildIsolatedEnv(
  gitDir: string,
  root: string,
  objects: string,
): Readonly<Record<string, string>> {
  return {
    ...isolatedConfigEnv,
    GIT_DIR: gitDir,
    GIT_COMMON_DIR: gitDir,
    GIT_WORK_TREE: root,
    GIT_INDEX_FILE: join(gitDir, 'index'),
    GIT_OBJECT_DIRECTORY: join(gitDir, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: toQuotedGitPath(objects),
    GIT_DIFF_OPTS: '--unified=3',
    GIT_LITERAL_PATHSPECS: '0',
    GIT_GLOB_PATHSPECS: '0',
    GIT_NOGLOB_PATHSPECS: '0',
    GIT_ICASE_PATHSPECS: '0',
  };
}

// git splits the alternates list at `:`, unless an entry is quoted the way C quotes a string.
function toQuotedGitPath(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}

async function copySkipWorktreeFlags(
  host: FingerprintHost,
  root: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const tagged = await host.runGitBytes({ cwd: root, args: ['ls-files', '-t', '-z'] });

  for (const request of buildSkipWorktreeMarks({ root, env, taggedEntries: tagged })) {
    await host.runGit(request);
  }
}

async function addSubmodules(
  host: FingerprintHost,
  root: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const staged = await host.runGitBytes({ cwd: root, args: ['ls-files', '--stage', '-z'], env });

  for (const request of buildSubmoduleAdds({ root, env, stagedEntries: staged })) {
    await host.runGit(request);
  }
}

interface IgnoredPathsRequest {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly mergeBase: string;
  readonly ignore: readonly string[];
}

// Each changed path an ignore glob matches goes back to its merge-base state in the index, so the
// diff leaves it out. The names go to git as the bytes it listed, on stdin, so a name that is not
// UTF-8 still matches, no count of names outgrows the argument list, and `*` stays a plain letter.
async function restoreIgnoredPaths(
  host: FingerprintHost,
  request: IgnoredPathsRequest,
): Promise<void> {
  if (request.ignore.length === 0) {
    return;
  }

  const names = await host.runGitBytes({
    cwd: request.root,
    args: [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--no-renames',
      '--no-relative',
      request.mergeBase,
    ],
    env: request.env,
  });

  const ignored = collectIgnoredNames(Buffer.from(names), request.ignore);

  if (ignored.length === 0) {
    return;
  }

  await host.runGit({
    cwd: request.root,
    args: [
      '--literal-pathspecs',
      'restore',
      '--staged',
      `--source=${request.mergeBase}`,
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ],
    stdin: Buffer.concat(ignored.flatMap((name) => [name, Buffer.from([0])])),
    env: request.env,
  });
}

// A name is matched as UTF-8, where a byte that is not UTF-8 reads as U+FFFD, as the changed paths
// read it, and kept as the bytes git wrote.
function collectIgnoredNames(output: Buffer, ignore: readonly string[]): readonly Buffer[] {
  const names: Buffer[] = [];
  let start = 0;

  while (start < output.length) {
    const end = output.indexOf(0, start);
    const stop = end === -1 ? output.length : end;
    const name = output.subarray(start, stop);

    if (name.length > 0 && isGlobMatch(name.toString('utf8'), ignore)) {
      names.push(name);
    }

    start = stop + 1;
  }

  return names;
}
