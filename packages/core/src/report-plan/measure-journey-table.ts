import { renderGapRow } from '../report/render-gap-row.ts';
import { renderTableHeader } from '../report/render-table-header.ts';
import { pickJourneyRows } from './pick-journey-rows.ts';

// The lengths of one row under each variant the plan can pick.
export interface RowSize {
  // With no Data column.
  readonly plain: number;

  // With a Data column and an empty cell.
  readonly withColumn: number;

  // What a shortened Evidence cell saves.
  readonly shortSaving: number;

  // The length of the Data cell's content; null when the step has no data.
  readonly dataChars: number | null;
}

export interface TableCuts {
  readonly collapsed: boolean;
  readonly droppedData: ReadonlySet<number>;
  readonly shortCells: ReadonlySet<number>;
}

// The length of the journey table that `renderJourneyTable` gives under the cuts, from the row
// sizes alone.
export function measureJourneyTable(rows: readonly RowSize[], cuts: TableCuts): number {
  const shown = pickJourneyRows(rows.length, cuts.collapsed);

  const hasData = shown.indexes.some(
    (index) => (rows[index]?.dataChars ?? null) !== null && !cuts.droppedData.has(index),
  );

  const rowChars = shown.indexes.map((index) => {
    const row = rows[index];

    if (row === undefined) {
      return 0;
    }

    const dataChars = cuts.droppedData.has(index) ? 0 : (row.dataChars ?? 0);
    const base = hasData ? row.withColumn + dataChars : row.plain;

    return cuts.shortCells.has(index) ? base - row.shortSaving : base;
  });

  const columns = hasData ? 5 : 4;
  const gapChars = shown.hidden === 0 ? [] : [renderGapRow(shown.hidden, columns).length];

  const lines = [
    '<table>'.length,
    renderTableHeader(hasData).length,
    ...rowChars,
    ...gapChars,
    '</table>'.length,
  ];

  return lines.reduce((total, chars) => total + chars, 0) + lines.length - 1;
}
