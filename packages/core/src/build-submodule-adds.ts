import type { GitRequest } from './run-git.ts';

export interface SubmoduleAddInput {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;

  // The output of `git ls-files --stage -z` over the temporary index.
  readonly stagedEntries: string;
}

// `add --all` skips a submodule that the repo's config marks `ignore = all` on newer git, so its
// new commit would never reach the diff; `--force` stages it whatever the config says.
export function buildSubmoduleAdds(input: SubmoduleAddInput): GitRequest[] {
  const paths = collectSubmodulePaths(input.stagedEntries);

  if (paths.length === 0) {
    return [];
  }

  return [{ cwd: input.cwd, args: ['add', '--force', '--', ...paths], env: input.env }];
}

const gitlinkMode = '160000';

// A path may hold a tab, so only the first tab ends the mode, object and stage.
function collectSubmodulePaths(stagedEntries: string): string[] {
  return stagedEntries.split('\0').flatMap((entry) => {
    const tab = entry.indexOf('\t');

    if (tab === -1 || !entry.startsWith(`${gitlinkMode} `)) {
      return [];
    }

    return [`:(top,literal)${entry.slice(tab + 1)}`];
  });
}
