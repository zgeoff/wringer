import type { ReportDocument } from '../report-document/report-document.ts';
import { reportMarkers } from '../report-document/report-markers.ts';
import type { ReportPlan } from '../report-plan/report-plan.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { hasLinkedFile } from './has-linked-file.ts';
import { renderDataComment } from './render-data-comment.ts';
import { renderDataNote } from './render-data-note.ts';
import { renderFeatureLine } from './render-feature-line.ts';
import { renderUnchangedLine } from './render-unchanged-line.ts';
import { renderUnmappedLine } from './render-unmapped-line.ts';

// The whole span, from its opening marker to its closing one. Pure: the same document, plan and
// secrets always give the same text. The secret set scrubs each value before it is escaped, and the
// plan says which cuts the size planner took.
export function renderReport(
  document: ReportDocument,
  plan: ReportPlan,
  secrets: SecretSet,
): string {
  const changed = document.report.features.filter((feature) => feature.status !== 'unchanged');
  const unchanged = document.report.features.filter((feature) => feature.status === 'unchanged');

  const parts = [
    reportMarkers.open,
    ...(plan.cuts.droppedData > 0 ? [renderDataNote(hasLinkedFile(document, secrets))] : []),
    ...changed.map((feature) =>
      renderFeatureLine(feature, document.journeys.get(feature.name), {
        linkHosts: document.linkHosts,
        secrets,
        cuts: plan.features.get(feature.name),
      }),
    ),
    ...renderUnchangedLine(unchanged, secrets),
    ...renderUnmappedLine(document.report.unmapped, secrets),
    renderDataComment(document, secrets),
  ];

  return `${parts.join('\n\n')}\n${reportMarkers.close}`;
}
