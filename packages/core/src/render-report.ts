import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { renderJourneyTable } from './render-journey-table.ts';
import { renderReportComment, toReportComment } from './report-comment.ts';
import type { Journey, LocalCause, ReportDocument } from './report-document.ts';
import { reportMarkers } from './report-markers.ts';
import { reportSchema } from './report-schema.ts';
import type { Report } from './report-schema.ts';

// The whole span, from its opening marker to its closing one. Pure: the same document and secrets
// always give the same text. The secret set scrubs each value before it is escaped.
export function renderReport(document: ReportDocument, secrets: SecretSet): string {
  const parts = [
    reportMarkers.open,
    renderSummaryTable(document, secrets),
    ...renderUnmappedLine(document.report.unmapped, secrets),
    ...document.report.features.flatMap((feature) => {
      const journey = document.journeys.get(feature.name);

      return journey === undefined
        ? []
        : [renderSection(feature, journey, document.linkHosts, secrets)];
    }),
    renderDataComment(document, secrets),
  ];

  return `${parts.join('\n\n')}\n${reportMarkers.close}`;
}

const statusLabels = {
  verified: 'verified',
  stale: 'stale: verified at an older fingerprint',
  missing: 'missing: no verdict',
  unchanged: 'unchanged',
  unpinned: 'unpinned: the target reports no commit',
} as const;

function renderSummaryTable(document: ReportDocument, secrets: SecretSet): string {
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

type FeatureReport = Report['features'][number];

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

function formatJourneySize(journey: Journey): string {
  const count = journey.steps.length;
  const totalMs = journey.steps.reduce((total, step) => total + step.durationMs, 0);
  const time = totalMs < 1000 ? `${totalMs} ms` : `${Math.round(totalMs / 1000)} s`;

  return `${count} ${count === 1 ? 'command' : 'commands'}, ${time}`;
}

function renderUnmappedLine(unmapped: readonly string[], secrets: SecretSet): readonly string[] {
  if (unmapped.length === 0) {
    return [];
  }

  const paths = unmapped.map(
    (path) =>
      `<code>${escapeReportText(secrets.scrubText(path).replaceAll(/[`<>]/gu, ''), secrets)}</code>`,
  );

  return [`<p>Changed paths that no feature maps: ${paths.join(', ')}.</p>`];
}

function renderSection(
  feature: FeatureReport,
  journey: Journey,
  linkHosts: readonly string[],
  secrets: SecretSet,
): string {
  const note =
    journey.evidence === 'upload'
      ? []
      : [`<p><i>${renderNote(feature, journey.evidence, secrets)}</i></p>`];

  const table = journey.steps.length === 0 ? [] : [renderJourneyTable(journey, linkHosts, secrets)];

  return [
    '<details>',
    `<summary>${escapeReportText(feature.name, secrets)}: ${escapeReportText(formatJourneySize(journey), secrets)}</summary>`,
    '',
    ...note,
    ...table,
    '</details>',
  ].join('\n');
}

function renderNote(feature: FeatureReport, cause: LocalCause, secrets: SecretSet): string {
  const target = escapeReportText(feature.verdict?.target.name ?? '', secrets);

  const notes: Readonly<Record<LocalCause, string>> = {
    'target-local': `Evidence stays local: the target ${target} keeps evidence local. Set <code>evidence: 'upload'</code> on it to publish evidence.`,
    'recorded-local':
      'Evidence stays local: the verdict was recorded while its target kept evidence local.',
    'target-gone': `Evidence stays local: the target ${target} is no longer in the registry.`,
    'no-upload-flag': 'Evidence stays local: the report was built with <code>--no-upload</code>.',
    'run-log-missing': 'The run log is gone, so this journey has no rows.',
  };

  return notes[cause];
}

// The comment's JSON escaping turns `<` into `\u003c`, so a secret that holds `<` no longer matches
// afterwards. The secret set scrubs the report and the registry first, while the text is raw.
function renderDataComment(document: ReportDocument, secrets: SecretSet): string {
  const report = reportSchema.parse(secrets.scrubValue(document.report));

  return renderReportComment(toReportComment(report, secrets.scrubText(document.registry)));
}
