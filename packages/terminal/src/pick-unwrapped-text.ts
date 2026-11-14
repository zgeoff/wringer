// Joins each run of soft-wrapped rows into one line. Each logical line takes as many rows as it
// needs to reach its length. Only the rows from `totalRows - rows` down are the screen, and a line
// that began above them keeps its visible part.
export function pickUnwrappedText(
  wrappedText: string,
  logicalLines: readonly string[],
  totalRows: number,
  rows: number,
): string {
  const physicalRows = wrappedText.split('\n');
  const top = Math.max(0, totalRows - rows);
  const lines: string[] = [];
  let next = 0;

  for (const logical of logicalLines) {
    const first = next;
    const lineRows: string[] = [];
    let rest = logical;

    // The formatter trims the spaces that end a row, so a space at a wrap boundary is missing from
    // the row. The logical line still holds it: the spaces between two rows' text, less the ones
    // that begin the next row, ended this row.
    do {
      const row = physicalRows[next] ?? rest;
      const nextRow = physicalRows[next + 1];

      rest = rest.slice(row.length);
      next += 1;

      const between = rest.length - rest.trimStart().length;
      const leading = nextRow === undefined ? 0 : nextRow.length - nextRow.trimStart().length;
      const trailing = rest.trim() === '' ? '' : ' '.repeat(Math.max(0, between - leading));

      rest = rest.slice(trailing.length);

      lineRows.push(row + trailing);
    } while (rest.trim() !== '' && next < physicalRows.length);

    const visible = lineRows.slice(Math.max(first, top) - first);

    if (visible.length > 0) {
      lines.push(visible.join(''));
    }
  }

  return lines.join('\n');
}
