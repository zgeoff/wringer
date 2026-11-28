import type { Wringer } from '@wringer/core';

export interface DeadGlob {
  // `feature <name>`, `shared` or `ignore`.
  readonly where: string;
  readonly glob: string;
}

// Each feature, shared and ignore glob that matches none of the repo's files. A dead glob maps no
// change to its feature, or claims nothing, so it hides a rename or a typo.
export function collectDeadGlobs(wringer: Wringer, files: readonly string[]): readonly DeadGlob[] {
  const groups = [
    ...wringer.features.flatMap((feature) => [
      { where: `feature ${feature.name}`, globs: feature.paths, isFolderAllowed: false },
      { where: `feature ${feature.name} entries`, globs: feature.entries, isFolderAllowed: true },
      { where: `feature ${feature.name} extra`, globs: feature.extra, isFolderAllowed: false },
    ]),
    { where: 'shared', globs: wringer.shared, isFolderAllowed: false },
    { where: 'ignore', globs: wringer.ignore, isFolderAllowed: false },
  ];

  return groups.flatMap((group) =>
    group.globs.flatMap((glob) => {
      // An entry may name a folder, which covers every file under it.
      const patterns = group.isFolderAllowed
        ? [new Bun.Glob(glob), new Bun.Glob(`${glob.replace(/\/+$/u, '')}/**`)]
        : [new Bun.Glob(glob)];

      return files.some((file) => patterns.some((pattern) => pattern.match(file)))
        ? []
        : [{ where: group.where, glob }];
    }),
  );
}
