import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatJourneySize } from './format-journey-size.ts';
import type { FeatureReport, ReportDocument } from './report-document.ts';

const statusLabels = {
  verified: 'verified',
  stale: 'stale: verified at an older fingerprint',
  missing: 'missing: no verdict',
  unchanged: 'unchanged',
  unpinned: 'unpinned: the target reports no commit',
} as const;

export function renderSummaryTable(document: ReportDocument, secrets: SecretSet): string {
  const rows = document.report.features.map((feature) => {
    const journey = document.journeys.get(feature.name);

    const cells = [
      escapeReportText(feature.name, secrets),
      escapeReportText(statusLabels[feature.status], secrets),
      formatTarget(feature, secrets),
      journey === undefined ? '-' : escapeReportText(formatJourneySize(journey), secrets),
    ];

    return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  });

  return [
    '<table>',
    '<tr><th>Feature</th><th>Status</th><th>Target</th><th>Journey</th></tr>',
    ...rows,
    '</table>',
  ].join('\n');
}

function formatTarget(feature: FeatureReport, secrets: SecretSet): string {
  const verdict = feature.verdict;

  if (verdict === null) {
    return '-';
  }

  const name = escapeReportText(verdict.target.name, secrets);

  return verdict.pin.kind === 'deployed'
    ? `${name} (${escapeReportText(verdict.pin.revision.slice(0, 7), secrets)})`
    : name;
}
