import type { FeatureDefinition } from '@wringer/core';

export interface DeadGlob {
  readonly feature: string;
  readonly glob: string;
}

// Each feature's `paths` glob that matches none of the repo's files. A dead glob maps no change to
// its feature, so the gate never asks for that feature's verdict.
export function collectDeadGlobs(
  features: readonly FeatureDefinition[],
  files: readonly string[],
): readonly DeadGlob[] {
  return features.flatMap((feature) =>
    feature.paths.flatMap((glob) => {
      const pattern = new Bun.Glob(glob);

      return files.some((file) => pattern.match(file)) ? [] : [{ feature: feature.name, glob }];
    }),
  );
}
