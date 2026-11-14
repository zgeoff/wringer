import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';

// The line that names the changed paths no feature maps, or no line when there are none.
export function renderUnmappedLine(
  unmapped: readonly string[],
  secrets: SecretSet,
): readonly string[] {
  if (unmapped.length === 0) {
    return [];
  }

  const paths = unmapped.map(
    (path) =>
      `<code>${escapeReportText(secrets.scrubText(path).replaceAll(/[`<>]/gu, ''), secrets)}</code>`,
  );

  return [`<p>Changed paths that no feature maps: ${paths.join(', ')}.</p>`];
}
