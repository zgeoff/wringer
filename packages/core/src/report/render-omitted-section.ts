import type { FeatureReport, Journey } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { renderFeatureSummary } from './render-feature-summary.ts';

// The line that stands in for a journey section the size plan left out. It keeps the summary.
export function renderOmittedSection(
  feature: FeatureReport,
  journey: Journey,
  secrets: SecretSet,
): string {
  return `<p>${renderFeatureSummary(feature, journey, secrets)}. The journey is left out to fit the PR description.</p>`;
}
