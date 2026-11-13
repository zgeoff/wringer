import type { SecretSet } from './create-secret-set.ts';
import { evidenceSchema } from './envelope.ts';
import type { Evidence } from './envelope.ts';

const maxCodePoints = 2000;

// The JSON text of a step's data for a code block, or null when the step shows none: no data, empty
// data, or data that is one of the step's own evidence items.
export function formatStepData(
  data: unknown,
  files: readonly Evidence[],
  secrets: SecretSet,
): string | null {
  if (isEmptyData(data) || isEvidenceOf(data, files)) {
    return null;
  }

  const text = JSON.stringify(redactData(secrets.scrubValue(data)), null, 2);
  const points = text.split(/(?:)/u);

  const cut =
    points.length > maxCodePoints
      ? `${points.slice(0, maxCodePoints).join('')}\n… cut at 2,000 characters`
      : text;

  return cut.replaceAll(/[<>`]/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;

    return `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

function isEmptyData(data: unknown): boolean {
  if (data === null || data === undefined || data === '') {
    return true;
  }

  if (Array.isArray(data)) {
    return data.length === 0;
  }

  return typeof data === 'object' && Object.keys(data).length === 0;
}

function isEvidenceOf(data: unknown, files: readonly Evidence[]): boolean {
  const parsed = evidenceSchema.safeParse(data);

  return (
    parsed.success &&
    files.some(
      (file) =>
        file.kind === parsed.data.kind &&
        file.path === parsed.data.path &&
        file.sha256 === parsed.data.sha256,
    )
  );
}

const secretKey = /token|secret|api-?key|session|passw|authorization|cookie/iu;
const urlCredentials = /(?<scheme>[a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/giu;
const redacted = '[redacted]';

function redactData(data: unknown): unknown {
  if (typeof data === 'string') {
    return data.replaceAll(urlCredentials, '$<scheme>');
  }

  if (Array.isArray(data)) {
    return data.map((item: unknown) => redactData(item));
  }

  if (typeof data === 'object' && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        secretKey.test(key) ? redacted : redactData(value),
      ]),
    );
  }

  return data;
}
