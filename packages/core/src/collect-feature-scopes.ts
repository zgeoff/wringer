import type { FeatureScope } from './read-change-facts.ts';
import type { Wringer } from './types.ts';

// Each feature's scope is its `paths`, then every shared glob.
export function collectFeatureScopes(
  wringer: Pick<Wringer, 'features' | 'shared'>,
): readonly FeatureScope[] {
  return wringer.features.map((feature) => ({
    name: feature.name,
    globs: [...feature.paths, ...wringer.shared],
  }));
}
