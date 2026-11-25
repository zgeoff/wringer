import type { Envelope } from '@wringer/core';

// One line for an agent. Each free-text field folds its whitespace and is clipped, so a long
// message or a newline in a name never breaks the line.
export function renderBriefEnvelope(envelope: Envelope): string {
  const parts = [foldWhitespace(envelope.command), `ok=${String(envelope.ok)}`];

  if (envelope.error === null) {
    parts.push(`data=${clip(JSON.stringify(envelope.data ?? null))}`);
  } else {
    parts.push(
      `error.code=${envelope.error.code}`,
      `error.message=${clip(foldWhitespace(envelope.error.message))}`,
    );
  }

  if (envelope.truncatedPath !== undefined) {
    parts.push(`truncatedPath=${foldWhitespace(envelope.truncatedPath)}`);
  }

  parts.push(`evidence=${envelope.evidence.length}`);

  return `${parts.join(' ')}\n`;
}

function foldWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

export const briefFieldLimit = 200;
const truncationMarker = '…[truncated]';

// Counts code points, so a cut never splits a surrogate pair.
function clip(text: string): string {
  const characters = [...text];

  return characters.length <= briefFieldLimit
    ? text
    : `${characters.slice(0, briefFieldLimit).join('')}${truncationMarker}`;
}
