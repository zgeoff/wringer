import type { RegisteredFeature } from '../feature-definition.ts';
import { escapeGlob } from './escape-glob.ts';
import type { FeatureReach } from './parse-walk-cache.ts';

// Each feature with the globs of every file it owns in `paths`: its own `paths`, its `extra`, and
// each file its entries reach, escaped so each glob matches that file alone.
export function buildResolvedFeatures(
  features: readonly RegisteredFeature[],
  reach: ReadonlyMap<string, FeatureReach>,
): readonly RegisteredFeature[] {
  return features.map((feature) => ({
    ...feature,
    paths: [
      ...feature.paths,
      ...feature.extra,
      ...(reach.get(feature.name)?.reached ?? []).map((path) => escapeGlob(path)),
    ],
  }));
}
