import { reportCutLimits } from './report-cut-limits.ts';

export interface JourneyRows {
  // The steps the table shows, in order.
  readonly indexes: readonly number[];

  // The steps a collapsed table leaves out; they sit after the first `gapAfter` shown steps.
  readonly hidden: number;
  readonly gapAfter: number;
}

export function pickJourneyRows(count: number, collapsed: boolean): JourneyRows {
  const all = Array.from({ length: count }, (_unused, index) => index);

  if (!collapsed || count < reportCutLimits.collapseFromRows) {
    return { indexes: all, hidden: 0, gapAfter: count };
  }

  return {
    indexes: [
      ...all.slice(0, reportCutLimits.keptEdgeRows),
      ...all.slice(count - reportCutLimits.keptEdgeRows),
    ],
    hidden: count - 2 * reportCutLimits.keptEdgeRows,
    gapAfter: reportCutLimits.keptEdgeRows,
  };
}
