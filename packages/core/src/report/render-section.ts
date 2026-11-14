import type { FeatureReport, Journey } from '../report-document/report-document.ts';
import type { FeaturePlan } from '../report-plan/report-plan.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { renderJourneyTable } from './render-journey-table.ts';
import { renderOmittedSection } from './render-omitted-section.ts';
import { renderSectionFrame } from './render-section-frame.ts';

export interface SectionOptions {
  readonly linkHosts: readonly string[];
  readonly secrets: SecretSet;
  readonly cuts: FeaturePlan | undefined;
}

// One feature's collapsed journey section, or the line that stands in for it when the plan leaves
// it out.
export function renderSection(
  feature: FeatureReport,
  journey: Journey,
  options: SectionOptions,
): string {
  if (options.cuts?.omitted === true) {
    return renderOmittedSection(feature, journey, options.secrets);
  }

  const table =
    journey.steps.length === 0
      ? []
      : [renderJourneyTable(journey, options.linkHosts, options.secrets, options.cuts)];

  return [renderSectionFrame(feature, journey, options.secrets), ...table, '</details>'].join('\n');
}
