import type { Report } from './report-schema.ts';

export const reportBlockOpen = '<!-- wringer-report v1';
export const reportBlockClose = '-->';

const statusLabels = {
  verified: 'verified',
  stale: 'stale: verified at an older fingerprint',
  missing: 'missing: no verdict',
  unchanged: 'unchanged',
  unpinned: 'unpinned: the target reports no commit',
} as const;

// The readable summary comes first, then the JSON report in a hidden block that `gate` reads back.
// JSON never holds `-->`, because every `>` in it is escaped.
export function renderReportMarkdown(report: Report): string {
  const lines = [
    '## wringer report',
    '',
    `Fingerprint \`${report.fingerprint}\` against \`${report.base}\`: ${pickSummary(report)}.`,
    '',
    '| Feature | Status | Evidence |',
    '| --- | --- | --- |',
    ...report.features.map(
      (feature) =>
        `| ${feature.name} | ${statusLabels[feature.status]} | ${formatEvidence(feature.verdict?.evidence ?? [])} |`,
    ),
    '',
    ...formatUnmapped(report.unmapped),
    reportBlockOpen,
    JSON.stringify(report).replaceAll('>', String.raw`\u003e`),
    reportBlockClose,
    '',
  ];

  return lines.join('\n');
}

function pickSummary(report: Report): string {
  if (report.complete) {
    return 'every changed feature is verified';
  }

  return report.unmapped.length > 0
    ? 'some changed paths map to no feature'
    : 'some changed features need a verdict';
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

function formatUnmapped(unmapped: readonly string[]): readonly string[] {
  if (unmapped.length === 0) {
    return [];
  }

  return [
    'Changed paths that no feature maps. Map each to a feature, or add it to the ignore list:',
    '',
    ...unmapped.map((path) => `- \`${path}\``),
    '',
  ];
}
