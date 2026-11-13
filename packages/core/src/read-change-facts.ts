import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { ChangeRequest } from './build-change-request.ts';
import { buildPromisedObjectReads } from './build-promised-object-reads.ts';
import { buildSkipWorktreeMarks } from './build-skip-worktree-marks.ts';
import { buildSubmoduleAdds } from './build-submodule-adds.ts';
import { isGlobMatch } from './is-glob-match.ts';
import { parseDiffOutput } from './parse-diff-output.ts';
import { emptyFingerprint, parsePatchID } from './parse-patch-id.ts';
import { parseRawEntries } from './parse-raw-entries.ts';
import { pickMergeBaseFailure } from './pick-merge-base-failure.ts';
import { pickMergeBaseSteps } from './pick-merge-base-steps.ts';
import { pickSubmoduleRefusal } from './pick-submodule-refusal.ts';
import type { GitRequest } from './run-git.ts';
import type { ProcessResult } from './run-process.ts';
import { splitDiffByPath } from './split-diff-by-path.ts';
import type { PathChunk } from './split-diff-by-path.ts';
import { WringerError } from './wringer-error.ts';

export interface ChangeFactsHost {
  readonly runGit: (request: GitRequest) => Promise<ProcessResult>;
  readonly runGitBytes: (request: GitRequest) => Promise<Uint8Array>;
  readonly removeDirectory: (path: string) => Promise<void>;
}

export interface FeatureScope {
  readonly name: string;
  readonly globs: readonly string[];
}

// `ignore` holds globs of paths with no runtime effect: a change to a path one matches leaves every
// fingerprint and the changed paths alone.
export interface ChangeFactsRequest extends ChangeRequest {
  readonly scopes: readonly FeatureScope[];

  // A full commit id. The facts then list each path whose content differs between that commit and
  // the isolated index, leaving out paths an ignore glob matches.
  readonly deployed: string | null;
}

// A patch ID, or 'empty' for a diff with no file.
export type Fingerprint = string;

export interface ChangeFacts {
  readonly mergeBase: string;
  readonly fingerprint: Fingerprint;
  readonly changedPaths: readonly string[];
  readonly featureFingerprints: ReadonlyMap<string, Fingerprint>;
  readonly deployedPaths: readonly string[] | null;
}

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

// The index is built and diffed in a git folder of its own, so no config, attributes or ignore
// rules of the clone, the user or the system reach it. One diff of it against the merge base gives
// the changed paths and every fingerprint, so they describe the same files.
export async function readChangeFacts(
  host: ChangeFactsHost,
  request: ChangeFactsRequest,
): Promise<ChangeFacts> {
  const root = await readRepoRoot(host, request.cwd);
  const mergeBase = await readMergeBase(host, root, request.base);

  await readPromisedObjects(host, root, mergeBase);
  await readSubmoduleWork(host, root, request.ignore);

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

    const exclusions = request.exclude.map((path) => `:(top,exclude)${path}`);

    // The exclusions apply to the diff, not to `add`: `add` refuses an ignored path in a pathspec,
    // and a committed change to an excluded path reaches the index from the repo's own anyway.
    const output = await host.runGitBytes({
      cwd: root,
      args: [
        'diff',
        '--cached',
        '--raw',
        '--binary',
        '-z',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-relative',
        ...pinnedDiffOptions,
        mergeBase,
        '--',
        ':(top)',
        ...exclusions,
      ],
      env,
    });

    const parsed = parseDiffOutput(output);
    const entries = parsed.entries;
    const chunks = splitDiffByPath(parsed.patch, entries);

    const fingerprint = await readPatchID(host, { root, env, patch: parsed.patch });

    const featureFingerprints = await readFeatureFingerprints(host, {
      root,
      env,
      chunks,
      scopes: request.scopes,
    });

    const deployedPaths =
      request.deployed === null
        ? null
        : await readDeployedPaths(host, { root, env, deployed: request.deployed, request });

    return {
      mergeBase,
      fingerprint,
      changedPaths: entries.map((entry) => entry.path.toString('utf8')).toSorted(),
      featureFingerprints,
      deployedPaths,
    };
  } finally {
    await host.removeDirectory(gitDir);
  }
}

// From a subfolder, `ls-files` lists only that folder, with paths relative to it, so every index
// step runs from the root.
async function readRepoRoot(host: ChangeFactsHost, cwd: string): Promise<string> {
  const result = await host.runGit({ cwd, args: ['rev-parse', '--show-toplevel'] });

  // A folder name may end in a space, so only the line end git adds comes off.
  return resolve(cwd, result.stdout.replace(/\n$/u, ''));
}

async function readMergeBase(host: ChangeFactsHost, root: string, base: string): Promise<string> {
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
  host: ChangeFactsHost,
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
async function readSubmoduleWork(
  host: ChangeFactsHost,
  root: string,
  ignore: readonly string[],
): Promise<void> {
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

  const refusal = pickSubmoduleRefusal(status, ignore);

  if (refusal !== null) {
    throw refusal;
  }
}

// git prints a path inside the git folder relative to the folder it runs in; the path leaves here
// absolute.
async function readGitPath(host: ChangeFactsHost, root: string, name: string): Promise<string> {
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
  host: ChangeFactsHost,
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
  host: ChangeFactsHost,
  root: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const tagged = await host.runGitBytes({ cwd: root, args: ['ls-files', '-t', '-z'] });

  for (const request of buildSkipWorktreeMarks({ root, env, taggedEntries: tagged })) {
    await host.runGit(request);
  }
}

async function addSubmodules(
  host: ChangeFactsHost,
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
  host: ChangeFactsHost,
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

// A name matches as the changed paths decode it, and stays the bytes git wrote. An ignored name
// stays in the diff when a counted name sits inside it or around it, such as a file that became a
// folder: restoring one would remove the other from the index.
function collectIgnoredNames(output: Buffer, ignore: readonly string[]): readonly Buffer[] {
  const names = collectNames(output);
  const ignored = names.filter((name) => isGlobMatch(name.toString('utf8'), ignore));
  const counted = names.filter((name) => !ignored.includes(name));

  return ignored.filter(
    (name) => !counted.some((other) => isInsidePath(other, name) || isInsidePath(name, other)),
  );
}

function collectNames(output: Buffer): readonly Buffer[] {
  const names: Buffer[] = [];
  let start = 0;

  while (start < output.length) {
    const end = output.indexOf(0, start);
    const stop = end === -1 ? output.length : end;

    if (stop > start) {
      names.push(output.subarray(start, stop));
    }

    start = stop + 1;
  }

  return names;
}

function isInsidePath(path: Buffer, folder: Buffer): boolean {
  return (
    path.length > folder.length &&
    path[folder.length] === 0x2f &&
    path.subarray(0, folder.length).equals(folder)
  );
}

interface PatchRequest {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly patch: Uint8Array;
}

async function readPatchID(host: ChangeFactsHost, request: PatchRequest): Promise<Fingerprint> {
  const patchID = await host.runGit({
    cwd: request.root,

    // `--verbatim` hashes with the stable algorithm and keeps whitespace, so `"a b"` and `"ab"`
    // differ; `--stable` alone drops it, and git refuses the two flags together.
    args: ['patch-id', '--verbatim'],
    stdin: request.patch,
    env: request.env,
  });

  return parsePatchID(patchID.stdout);
}

interface FeatureFingerprintsRequest {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly chunks: readonly PathChunk[];
  readonly scopes: readonly FeatureScope[];
}

// How many `patch-id` processes run at once.
const patchIDBatchSize = 8;

async function readFeatureFingerprints(
  host: ChangeFactsHost,
  request: FeatureFingerprintsRequest,
): Promise<ReadonlyMap<string, Fingerprint>> {
  const fingerprints = new Map<string, Fingerprint>();

  for (let start = 0; start < request.scopes.length; start += patchIDBatchSize) {
    const batch = request.scopes.slice(start, start + patchIDBatchSize);

    const read = await Promise.all(
      batch.map((scope) => {
        const patch = collectScopePatch(request.chunks, scope.globs);

        return patch === null
          ? Promise.resolve(emptyFingerprint)
          : readPatchID(host, { root: request.root, env: request.env, patch });
      }),
    );

    batch.forEach((scope, index) => {
      fingerprints.set(scope.name, read[index] ?? emptyFingerprint);
    });
  }

  return fingerprints;
}

// The chunks of the paths a glob matches, in the order of the paths' bytes, or null for none.
function collectScopePatch(chunks: readonly PathChunk[], globs: readonly string[]): Buffer | null {
  const matching = chunks
    .filter((chunk) => isGlobMatch(chunk.path.toString('utf8'), globs))
    .toSorted((left, right) => Buffer.compare(left.path, right.path));

  return matching.length === 0 ? null : Buffer.concat(matching.map((chunk) => chunk.bytes));
}

interface DeployedRequest {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly deployed: string;
  readonly request: ChangeRequest;
}

// Every path either side holds counts, deletions included. The state folder stays out, as it does
// from the diff.
async function readDeployedPaths(
  host: ChangeFactsHost,
  request: DeployedRequest,
): Promise<readonly string[]> {
  const raw = await host.runGitBytes({
    cwd: request.root,
    args: [
      'diff',
      '--cached',
      '--raw',
      '-z',
      '--no-abbrev',
      '--no-renames',
      '--no-relative',
      '--no-textconv',
      '--ignore-submodules=none',
      request.deployed,
      '--',
      ':(top)',
      ...request.request.exclude.map((path) => `:(top,exclude)${path}`),
    ],
    env: request.env,
  });

  return parseRawEntries(raw)
    .map((entry) => entry.path.toString('utf8'))
    .filter((path) => !isGlobMatch(path, request.request.ignore))
    .toSorted();
}
