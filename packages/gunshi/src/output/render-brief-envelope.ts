import type { Envelope } from '@wringer/core';

// One line for an agent: the command, whether it passed, the error or a one-line summary of the
// data, and how much evidence it kept. Newlines in a message or in data fold into spaces.
export function renderBriefEnvelope(envelope: Envelope): string {
  const parts = [envelope.command, `ok=${String(envelope.ok)}`];

  if (envelope.error === null) {
    parts.push(`data=${summarizeData(envelope.data)}`);
  } else {
    parts.push(
      `error.code=${envelope.error.code}`,
      `error.message=${foldWhitespace(envelope.error.message)}`,
    );
  }

  if (envelope.truncatedPath !== undefined) {
    parts.push(`truncatedPath=${envelope.truncatedPath}`);
  }

  parts.push(`evidence=${envelope.evidence.length}`);

  return `${parts.join(' ')}\n`;
}

export const briefDataLimit = 200;
const truncationMarker = '…[truncated]';

function summarizeData(data: unknown): string {
  const text = foldWhitespace(JSON.stringify(data ?? null));

  return text.length <= briefDataLimit
    ? text
    : `${text.slice(0, briefDataLimit)}${truncationMarker}`;
}

function foldWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}
