import type { Envelope } from '@wringer/core';

// One line for an agent. Each free-text field folds its whitespace and is clipped, so a long
// message or a newline in a name never breaks the line.
export function renderBriefEnvelope(envelope: Envelope): string {
  const parts = [foldWhitespace(envelope.command), `ok=${String(envelope.ok)}`];

  if (envelope.error === null) {
    const json = JSON.stringify(envelope.data ?? null);

    parts.push(`data=${clip(escapeLineSeparators(json))}`);
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

const graphemes = new Intl.Segmenter();

// Counts characters as a reader sees them, so a cut never splits an emoji.
function clip(text: string): string {
  const characters = [...graphemes.segment(text)].map((part) => part.segment);

  return characters.length <= briefFieldLimit
    ? text
    : `${characters.slice(0, briefFieldLimit).join('')}${truncationMarker}`;
}

// JSON leaves these two separators raw, and a terminal can show each as a line break.
function escapeLineSeparators(text: string): string {
  return text.replaceAll(
    /[\u2028\u2029]/gu,
    (separator) => `\\u${separator.codePointAt(0)?.toString(16) ?? ''}`,
  );
}
