import { isGlobMatch } from '@wringer/core';
import type { Wringer } from '@wringer/core';

// Each file that no feature's `paths`, no shared glob and no ignore glob matches. The gate cannot
// tell what such a file changes, so it fails on it.
export function collectUnclaimedFiles(
  wringer: Wringer,
  files: readonly string[],
): readonly string[] {
  const globs = [
    ...wringer.features.flatMap((feature) => feature.paths),
    ...wringer.shared,
    ...wringer.ignore,
  ];

  return files.filter((file) => !isGlobMatch(file, globs));
}
