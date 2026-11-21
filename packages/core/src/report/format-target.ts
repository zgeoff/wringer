import type { FeatureReport } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';

// The verdict's target by name, with the first 7 characters of a deployed revision; null when the
// feature has no verdict.
export function formatTarget(feature: FeatureReport, secrets: SecretSet): string | null {
  const verdict = feature.verdict;

  if (verdict === null) {
    return null;
  }

  const name = escapeReportText(verdict.target.name, secrets);

  return verdict.pin.kind === 'deployed'
    ? `${name} (${escapeReportText(verdict.pin.revision.slice(0, 7), secrets)})`
    : name;
}
