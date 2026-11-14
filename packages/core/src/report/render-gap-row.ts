// The row that stands where a collapsed table leaves out steps.
export function renderGapRow(hidden: number, columns: number): string {
  return `<tr><td colspan="${columns}">${hidden} more steps not shown</td></tr>`;
}
