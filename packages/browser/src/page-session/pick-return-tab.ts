// When the active tab closes, the driver goes back to the tab that opened it, or else to the tab
// beside it. The indexes count the tabs that remain, and a null answer means none remain.
export function pickReturnTab(
  openerIndex: number | null,
  closedIndex: number,
  remainingCount: number,
): number | null {
  if (remainingCount === 0) {
    return null;
  }

  if (openerIndex !== null) {
    return openerIndex;
  }

  return Math.min(Math.max(closedIndex - 1, 0), remainingCount - 1);
}
