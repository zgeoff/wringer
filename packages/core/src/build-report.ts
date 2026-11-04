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
// the branch leaves alone is `unchanged`, whatever its verdict.
export function buildReport(input: ReportInput): Report {
  const features = input.features.map((feature) => {
    const changed = input.changedPaths.some((path) =>
      feature.paths.some((pattern) => new Bun.Glob(pattern).match(path)),
    );

    const verdict = input.verdicts.get(feature.name) ?? null;

    return {
      name: feature.name,
      changed,
      status: pickFeatureStatus(changed, verdict, input.fingerprint),
      verdict,
    };
  });

  return {
    version: 1,
    base: input.base,
    fingerprint: input.fingerprint,
    complete: features.every(
      (feature) => feature.status === 'verified' || feature.status === 'unchanged',
    ),
    features,
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
