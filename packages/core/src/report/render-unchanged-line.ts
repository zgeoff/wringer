import type { FeatureReport } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';

const namedFromCount = 4;
const keptNames = 2;

// The paragraph that names the unchanged features, or no line when there are none. It names all of
// them up to 3, and else the first 2 and how many more.
export function renderUnchangedLine(
  features: readonly FeatureReport[],
  secrets: SecretSet,
): readonly string[] {
  if (features.length === 0) {
    return [];
  }

  const names = features.map(
    (feature) => `<code>${escapeReportText(feature.name, secrets)}</code>`,
  );

  const shown =
    names.length < namedFromCount
      ? names
      : [...names.slice(0, keptNames), `${names.length - keptNames} more`];

  const head = shown.slice(0, -1).join(', ');
  const list = head === '' ? (shown[0] ?? '') : `${head} and ${shown.at(-1) ?? ''}`;

  return [`<p>Unchanged: ${list}.</p>`];
}
