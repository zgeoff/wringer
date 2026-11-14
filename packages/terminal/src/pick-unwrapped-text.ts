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
    let length = 0;

    do {
      length += physicalRows[next]?.length ?? logical.length;
      next += 1;
    } while (length < logical.length && next < physicalRows.length);

    const visible = physicalRows.slice(Math.max(first, top), next);

    if (visible.length > 0) {
      lines.push(visible.join(''));
    }
  }

  return lines.join('\n');
}
