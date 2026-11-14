export type ScreenPattern =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'regex'; readonly source: string };

export interface ScreenMatch {
  readonly row: number;
  readonly col: number;
}

// The first match in reading order, as the row and the column of its first character, both from 0.
// The pattern's regex is checked when the command is parsed, so a bad one here matches nothing.
export function findScreenMatch(text: string, pattern: ScreenPattern): ScreenMatch | null {
  const lines = text.split('\n');

  if (pattern.kind === 'text') {
    return findInLines(lines, (line) => line.indexOf(pattern.text));
  }

  const regex = new RegExp(pattern.source, 'u');

  return findInLines(lines, (line) => line.search(regex));
}

function findInLines(
  lines: readonly string[],
  locate: (line: string) => number,
): ScreenMatch | null {
  for (const [row, line] of lines.entries()) {
    const col = locate(line);

    if (col >= 0) {
      return { row, col };
    }
  }

  return null;
}
