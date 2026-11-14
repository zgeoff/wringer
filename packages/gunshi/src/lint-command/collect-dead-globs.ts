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
    ...wringer.features.map((feature) => ({
      where: `feature ${feature.name}`,
      globs: feature.paths,
    })),
    { where: 'shared', globs: wringer.shared },
    { where: 'ignore', globs: wringer.ignore },
  ];

  return groups.flatMap((group) =>
    group.globs.flatMap((glob) => {
      const pattern = new Bun.Glob(glob);

      return files.some((file) => pattern.match(file)) ? [] : [{ where: group.where, glob }];
    }),
  );
}
