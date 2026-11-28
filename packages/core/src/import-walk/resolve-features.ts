import type { RepoHost, Wringer } from '../types.ts';
import { buildResolvedFeatures } from './build-resolved-features.ts';
import type { FeatureReach } from './parse-walk-cache.ts';
import { readFeatureReach } from './read-feature-reach.ts';

export interface ResolvedFeatures {
  // The registry with each feature's `paths` widened to every file it owns, so every reader that
  // matches a path against `paths` counts the files its entries reach.
  readonly wringer: Wringer;
  readonly reach: ReadonlyMap<string, FeatureReach>;
}

// A registry whose features name no `entries` comes back as it is, and loads no parser.
export async function resolveFeatures(
  host: RepoHost,
  wringer: Wringer,
  root: string,
): Promise<ResolvedFeatures> {
  const reach = await readFeatureReach(host, {
    root,
    stateDir: wringer.stateDir,
    features: wringer.features,
  });

  if (reach.size === 0) {
    return { wringer, reach };
  }

  return {
    wringer: { ...wringer, features: buildResolvedFeatures(wringer.features, reach) },
    reach,
  };
}
