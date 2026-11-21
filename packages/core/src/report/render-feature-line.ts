import type { FeatureReport, Journey } from '../report-document/report-document.ts';
import type { FeaturePlan } from '../report-plan/report-plan.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { renderSection } from './render-section.ts';
import { renderStatusLine } from './render-status-line.ts';

export interface FeatureLineOptions {
  readonly linkHosts: readonly string[];
  readonly secrets: SecretSet;
  readonly cuts: FeaturePlan | undefined;
}

// One changed feature's line: the journey section of a verified feature, or the paragraph of any
// other status. A verified feature with no journey gets the paragraph too.
export function renderFeatureLine(
  feature: FeatureReport,
  journey: Journey | undefined,
  options: FeatureLineOptions,
): string {
  return feature.status === 'verified' && journey !== undefined
    ? renderSection(feature, journey, options)
    : renderStatusLine(feature, options.secrets);
}
