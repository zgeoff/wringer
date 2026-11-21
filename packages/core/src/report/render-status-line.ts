import type { FeatureReport } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';

interface StatusLine {
  readonly mark: string;
  readonly label: string;
  readonly fix: string;
}

const publish = 'then <code>bun verify publish</code>';
const rerun = `run its journey and <code>bun verify done</code> again, ${publish}`;

const statusLines = {
  verified: { mark: '✅', label: 'verified', fix: '' },
  stale: { mark: '⚠️', label: 'stale', fix: `Fix it: ${rerun}.` },
  missing: {
    mark: '❌',
    label: 'no verdict',
    fix: `Fix it: run its journey and <code>bun verify done</code>, ${publish}.`,
  },
  unpinned: {
    mark: '⚠️',
    label: 'unpinned',
    fix: `The target reports no commit, and the registry refuses an unpinned verdict. Fix it: point the feature at a target that reports its commit, ${rerun}.`,
  },
  unchanged: { mark: '', label: 'unchanged', fix: '' },
} as const satisfies Record<FeatureReport['status'], StatusLine>;

// The paragraph of a changed feature that has no journey section: a stale, missing or unpinned
// one, with the fix.
export function renderStatusLine(feature: FeatureReport, secrets: SecretSet): string {
  const line: StatusLine = statusLines[feature.status];
  const name = `<code>${escapeReportText(feature.name, secrets)}</code>`;
  const parts = [`${line.mark} ${name}`, line.label, ...(line.fix === '' ? [] : [line.fix])];

  return `<p>${parts.join(' · ')}</p>`;
}
