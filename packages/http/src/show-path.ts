import type { Redaction } from './redaction/build-redaction.ts';
import { redactQuery } from './redaction/redact-query.ts';

// The path as a message may show it: each redacted query value replaced, and a path that carries
// a username or password in its URL cut to a fixed text, so the password never reaches a message.
export function showPath(path: string, redaction: Redaction): string {
  const url = URL.parse(path, 'http://wringer.invalid');

  if (url !== null && (url.username !== '' || url.password !== '')) {
    return '[a URL with credentials]';
  }

  return redactQuery(path, redaction).text;
}
