import type { SecretSet } from '../secrets/create-secret-set.ts';

// A value from the registry, a run or a verdict, as HTML text on one line. The secret set scrubs the
// raw value first, because an entity such as `&amp;` no longer matches a secret that holds `&`.
export function escapeReportText(value: string, secrets: SecretSet): string {
  return secrets
    .scrubText(value)
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;');
}
