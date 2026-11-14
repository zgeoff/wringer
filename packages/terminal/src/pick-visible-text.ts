// The formatter prints every row the terminal holds, scrollback included, and drops the blank rows
// at the end. The screen is the last `rows` physical rows, so the text starts at row
// `totalRows - rows`.
export function pickVisibleText(text: string, totalRows: number, rows: number): string {
  const top = Math.max(0, totalRows - rows);

  return text.split('\n').slice(top).join('\n');
}
