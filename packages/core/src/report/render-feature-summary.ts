import type { FeatureReport, Journey } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatJourneyStats } from './format-journey-stats.ts';
import { formatTarget } from './format-target.ts';

// The one line of a verified feature: its mark, name, command count, duration and target.
export function renderFeatureSummary(
  feature: FeatureReport,
  journey: Journey,
  secrets: SecretSet,
): string {
  const target = formatTarget(feature, secrets);

  return [
    `✅ <code>${escapeReportText(feature.name, secrets)}</code>`,
    escapeReportText(formatJourneyStats(journey), secrets),
    ...(target === null ? [] : [target]),
  ].join(' · ');
}
