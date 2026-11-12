import { isGlobMatch } from './is-glob-match.ts';
import type { FeatureStatus, Report, Verdict } from './report-schema.ts';
import type { FeatureDefinition } from './types.ts';

export interface ReportInput {
  readonly base: string;
  readonly fingerprint: string;
  readonly features: readonly FeatureDefinition[];
  readonly changedPaths: readonly string[];
  readonly verdicts: ReadonlyMap<string, Verdict>;
}

// Each feature whose paths the branch changes needs a verdict at the current fingerprint. A feature
// the branch leaves alone is `unchanged`, whatever its verdict. A changed path no feature maps is
// unmapped, and leaves the report incomplete.
export function buildReport(input: ReportInput): Report {
  const features = input.features.map((feature) => {
    const changed = input.changedPaths.some((path) => isGlobMatch(path, feature.paths));
    const verdict = input.verdicts.get(feature.name) ?? null;

    return {
      name: feature.name,
      changed,
      status: pickFeatureStatus(changed, verdict, input.fingerprint),
      verdict,
    };
  });

  const unmapped = input.changedPaths.filter(
    (path) => !input.features.some((feature) => isGlobMatch(path, feature.paths)),
  );

  return {
    version: 1,
    base: input.base,
    fingerprint: input.fingerprint,
    complete:
      unmapped.length === 0 &&
      features.every((feature) => feature.status === 'verified' || feature.status === 'unchanged'),
    features,
    unmapped,
  };
}

function pickFeatureStatus(
  changed: boolean,
  verdict: Verdict | null,
  fingerprint: string,
): FeatureStatus {
  if (!changed) {
    return 'unchanged';
  }

  if (verdict === null) {
    return 'missing';
  }

  return verdict.fingerprint === fingerprint ? 'verified' : 'stale';
}
