import { collectLines } from './collect-lines.ts';

export interface FencedRange {
  readonly start: number;
  readonly end: number;
}

const openFencePattern = /^ {0,3}(?<fence>`{3,}|~{3,})(?<info>.*)$/u;
const closeFencePattern = /^ {0,3}(?<fence>`{3,}|~{3,})[ \t]*$/u;

// The ranges of the code blocks fenced by backticks or tildes, each from its opening line to its
// closing line. A fence with no closing line runs to the end of the text.
export function collectFencedRanges(text: string): FencedRange[] {
  const ranges: FencedRange[] = [];
  let open: { readonly fence: string; readonly start: number } | null = null;

  for (const line of collectLines(text)) {
    if (open === null) {
      const groups = openFencePattern.exec(line.text)?.groups;
      const opening = groups?.['fence'];
      const info = groups?.['info'] ?? '';

      if (opening !== undefined && !(opening.startsWith('`') && info.includes('`'))) {
        open = { fence: opening, start: line.start };
      }

      continue;
    }

    const closing = closeFencePattern.exec(line.text)?.groups?.['fence'];

    if (
      closing !== undefined &&
      closing.startsWith(open.fence.charAt(0)) &&
      closing.length >= open.fence.length
    ) {
      ranges.push({ start: open.start, end: line.end });

      open = null;
    }
  }

  if (open !== null) {
    ranges.push({ start: open.start, end: text.length });
  }

  return ranges;
}
