import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';

const encoded: Readonly<Record<string, string>> = {
  ' ': '%20',
  '"': '%22',
  "'": '%27',
  '<': '%3C',
  '>': '%3E',
  '(': '%28',
  ')': '%29',
  '`': '%60',
  '\\': '%5C',
  '|': '%7C',
};

// A link for an HTML attribute, or null when it is not an `https` link to one of the hosts.
export function formatReportLink(
  url: string,
  linkHosts: readonly string[],
  secrets: SecretSet,
): string | null {
  const parsed = URL.parse(url);

  if (parsed?.protocol !== 'https:' || !linkHosts.includes(parsed.host)) {
    return null;
  }

  return escapeReportText(
    secrets.scrubText(url).replaceAll(/[ "'<>()`\\|]/gu, (char) => encoded[char] ?? char),
    secrets,
  );
}
