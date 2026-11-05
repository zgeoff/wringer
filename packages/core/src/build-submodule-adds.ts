import type { GitRequest } from './run-git.ts';

export interface SubmoduleAddInput {
  // The repo root, where `ls-files` printed each path relative to.
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;

  // The bytes of `git ls-files --stage -z` over the temporary index.
  readonly stagedEntries: Uint8Array;
}

const nul = Buffer.from([0]);

// `add --all` skips a submodule that the repo's config marks `ignore = all` on newer git, so its
// new commit would never reach the diff; `--force` stages it whatever the config says. The paths go
// to git on stdin as the bytes `ls-files` printed, and as literal paths, so `lib[1]` is no glob.
export function buildSubmoduleAdds(input: SubmoduleAddInput): GitRequest[] {
  const paths = collectSubmodulePaths(Buffer.from(input.stagedEntries));

  if (paths.length === 0) {
    return [];
  }

  return [
    {
      cwd: input.root,
      args: ['add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'],
      env: { ...input.env, GIT_LITERAL_PATHSPECS: '1' },
      stdin: Buffer.concat(paths.flatMap((path) => [path, nul])),
    },
  ];
}

const gitlinkPrefix = Buffer.from('160000 ');
const tab = 0x09;

// A path may hold a tab, so only the first tab ends the mode, object and stage.
function collectSubmodulePaths(stagedEntries: Buffer): Buffer[] {
  return collectEntries(stagedEntries).flatMap((entry) => {
    const pathStart = entry.indexOf(tab) + 1;

    if (pathStart === 0 || !entry.subarray(0, gitlinkPrefix.length).equals(gitlinkPrefix)) {
      return [];
    }

    return [entry.subarray(pathStart)];
  });
}

function collectEntries(stagedEntries: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;

  while (start < stagedEntries.length) {
    const end = stagedEntries.indexOf(0, start);
    const stop = end === -1 ? stagedEntries.length : end;

    entries.push(stagedEntries.subarray(start, stop));

    start = stop + 1;
  }

  return entries;
}
