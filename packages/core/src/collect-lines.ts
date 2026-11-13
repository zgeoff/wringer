export interface TextLine {
  readonly start: number;
  readonly text: string;

  // The offset just past the line's ending, or the text's length for a last line with none.
  readonly end: number;
}

export function collectLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;

  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const lineEnd = newline === -1 ? end : newline;
    const content = text.slice(start, lineEnd);

    lines.push({ start, text: content.endsWith('\r') ? content.slice(0, -1) : content, end });

    start = end;
  }

  return lines;
}
