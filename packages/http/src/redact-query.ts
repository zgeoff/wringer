import type { Redaction } from './build-redaction.ts';

export interface RedactedSecret {
  readonly name: string;
  readonly value: string;
}

export interface QueryRedaction {
  readonly text: string;
  readonly secrets: readonly RedactedSecret[];
}

// Replaces the value of each redacted parameter in the query of a URL or a path, and keeps every
// other character as it was: a `URLSearchParams` rewrite would encode the placeholder's brackets.
export function redactQuery(text: string, redaction: Redaction): QueryRedaction {
  const start = text.indexOf('?');

  if (start === -1) {
    return { text, secrets: [] };
  }

  const hash = text.indexOf('#', start);
  const end = hash === -1 ? text.length : hash;
  const secrets: RedactedSecret[] = [];

  const query = text
    .slice(start + 1, end)
    .split('&')
    .map((pair) => redactPair(pair, redaction, secrets))
    .join('&');

  return { text: `${text.slice(0, start + 1)}${query}${text.slice(end)}`, secrets };
}

function redactPair(pair: string, redaction: Redaction, secrets: RedactedSecret[]): string {
  const equals = pair.indexOf('=');

  if (equals === -1) {
    return pair;
  }

  const name = decodeQueryText(pair.slice(0, equals)).toLowerCase();
  const raw = pair.slice(equals + 1);

  if (raw === '' || !redaction.query.has(name)) {
    return pair;
  }

  const placeholderName = `http.query.${name}`;

  for (const value of new Set([decodeQueryText(raw), raw])) {
    secrets.push({ name: placeholderName, value });
  }

  return `${pair.slice(0, equals + 1)}[redacted:${placeholderName}]`;
}

function decodeQueryText(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
}
