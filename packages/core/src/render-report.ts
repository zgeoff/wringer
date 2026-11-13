import type { SecretSet } from './create-secret-set.ts';
import { renderDataComment } from './render-data-comment.ts';
import { renderSection } from './render-section.ts';
import { renderSummaryTable } from './render-summary-table.ts';
import { renderUnmappedLine } from './render-unmapped-line.ts';
import type { ReportDocument } from './report-document.ts';
import { reportMarkers } from './report-markers.ts';
import type { ReportPlan } from './report-plan.ts';

// The whole span, from its opening marker to its closing one. Pure: the same document, plan and
// secrets always give the same text. The secret set scrubs each value before it is escaped, and the
// plan says which cuts the size planner took.
export function renderReport(
  document: ReportDocument,
  plan: ReportPlan,
  secrets: SecretSet,
): string {
  const parts = [
    reportMarkers.open,
    renderSummaryTable(document, secrets),
    ...renderUnmappedLine(document.report.unmapped, secrets),
    ...document.report.features.flatMap((feature) => {
      const journey = document.journeys.get(feature.name);

      return journey === undefined
        ? []
        : [
            renderSection(feature, journey, {
              linkHosts: document.linkHosts,
              secrets,
              cuts: plan.features.get(feature.name),
            }),
          ];
    }),
    renderDataComment(document, secrets),
  ];

  return `${parts.join('\n\n')}\n${reportMarkers.close}`;
}
