import type { GitRequest } from './run-git.ts';

export interface SkipWorktreeMarkInput {
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;

  // The bytes of `git ls-files -t -z` over the repo's own index.
  readonly taggedEntries: Uint8Array;
}

const skipWorktreeTag = 'S ';

// A sparse checkout leaves a file outside it out of the working tree and marks its entry
// skip-worktree; without the mark on the temporary index, `add --all` would stage the file as
// deleted. latin1 maps each byte to one character, so a path that is not UTF-8 keeps its bytes.
export function buildSkipWorktreeMarks(input: SkipWorktreeMarkInput): GitRequest[] {
  const paths = Buffer.from(input.taggedEntries)
    .toString('latin1')
    .split('\0')
    .flatMap((entry) =>
      entry.startsWith(skipWorktreeTag) ? [`${entry.slice(skipWorktreeTag.length)}\0`] : [],
    );

  if (paths.length === 0) {
    return [];
  }

  return [
    {
      cwd: input.root,
      args: ['update-index', '-z', '--skip-worktree', '--stdin'],
      stdin: Buffer.from(paths.join(''), 'latin1'),
      env: input.env,
    },
  ];
}
