import type { FeatureReport, Journey } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatJourneySize } from './format-journey-size.ts';

// The line that stands in for a journey section the size plan left out.
export function renderOmittedSection(
  feature: FeatureReport,
  journey: Journey,
  secrets: SecretSet,
): string {
  const name = escapeReportText(feature.name, secrets);
  const size = escapeReportText(formatJourneySize(journey), secrets);

  return `<p>${name}: ${size}. The journey is left out to fit the PR description.</p>`;
}
