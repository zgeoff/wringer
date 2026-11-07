import type { Report } from './report-schema.ts';

export const reportBlockOpen = '<!-- wringer-report v1';
export const reportBlockClose = '-->';

const statusLabels = {
  verified: 'verified',
  stale: 'stale: verified at an older fingerprint',
  missing: 'missing: no verdict',
  unchanged: 'unchanged',
} as const;

// The readable summary comes first, then the JSON report in a hidden block that `gate` reads back.
// JSON never holds `-->`, because every `>` in it is escaped.
export function renderReportMarkdown(report: Report): string {
  const lines = [
    '## wringer report',
    '',
    `Fingerprint \`${report.fingerprint}\` against \`${report.base}\`: ${report.complete ? 'every changed feature is verified' : 'some changed features need a verdict'}.`,
    '',
    '| Feature | Status | Evidence |',
    '| --- | --- | --- |',
    ...report.features.map(
      (feature) =>
        `| ${feature.name} | ${statusLabels[feature.status]} | ${formatEvidence(feature.verdict?.evidence ?? [])} |`,
    ),
    '',
    reportBlockOpen,
    JSON.stringify(report).replaceAll('>', String.raw`\u003e`),
    reportBlockClose,
    '',
  ];

  return lines.join('\n');
}

function formatEvidence(
  evidence: readonly {
    readonly kind: string;
    readonly path: string;
    readonly url?: string | undefined;
  }[],
): string {
  if (evidence.length === 0) {
    return '-';
  }

  return evidence
    .map((item) =>
      item.url === undefined ? `${item.kind} \`${item.path}\`` : `[${item.kind}](${item.url})`,
    )
    .join(', ');
}
