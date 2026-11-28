import type { ScopedFeature } from '../feature-definition.ts';
import type { Wringer } from '../types.ts';
import type { FeatureScope } from './read-change-facts.ts';

// Each feature's scope is its `paths`, then every shared glob.
export function collectFeatureScopes(
  wringer: Pick<Wringer, 'shared'> & { readonly features: readonly ScopedFeature[] },
): readonly FeatureScope[] {
  return wringer.features.map((feature) => ({
    name: feature.name,
    globs: [...feature.paths, ...wringer.shared],
  }));
}
