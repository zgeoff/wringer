import { isGlobMatch } from './is-glob-match.ts';
import type { FeatureStatus, Report, Verdict } from './report-schema.ts';
import type { FeatureDefinition, GatePolicy } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface ReportInput {
  readonly base: string;
  readonly fingerprint: string;
  readonly features: readonly FeatureDefinition[];
  readonly featureFingerprints: ReadonlyMap<string, string>;
  readonly changedPaths: readonly string[];
  readonly shared: readonly string[];
  readonly ignore: readonly string[];
  readonly verdicts: ReadonlyMap<string, Verdict>;
  readonly policy: GatePolicy;
}

// A feature is changed when the diff limited to its scope is not empty, and then needs a verdict
// at its own fingerprint; an unpinned verdict fails only under a policy that refuses it. An unchanged feature is `unchanged`, whatever its verdict. A changed path
// that no feature, shared glob or ignore glob maps is unmapped, and leaves the report incomplete.
export function buildReport(input: ReportInput): Report {
  const features = input.features.map((feature) => {
    const current = input.featureFingerprints.get(feature.name);

    if (current === undefined) {
      throw new WringerError('internal', {
        message: `The change facts hold no fingerprint for the feature \`${feature.name}\`.`,
      });
    }

    const verdict = input.verdicts.get(feature.name) ?? null;

    return {
      name: feature.name,
      changed: current !== 'empty',
      status: pickFeatureStatus(current, verdict, input.policy),
      verdict,
    };
  });

  const unmapped = input.changedPaths.filter(
    (path) =>
      !input.features.some((feature) => isGlobMatch(path, feature.paths)) &&
      !isGlobMatch(path, input.shared) &&
      !isGlobMatch(path, input.ignore),
  );

  return {
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
  current: string,
  verdict: Verdict | null,
  policy: GatePolicy,
): FeatureStatus {
  if (current === 'empty') {
    return 'unchanged';
  }

  if (verdict === null) {
    return 'missing';
  }

  if (verdict.featureFingerprint !== current) {
    return 'stale';
  }

  return verdict.pin.kind === 'unpinned' && policy.unpinned === 'refuse' ? 'unpinned' : 'verified';
}
