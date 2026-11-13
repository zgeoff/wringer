// A data cell's content: the data text in a code block between blank lines, so a client that reads
// the cell as Markdown renders it. A step with no data gives an empty cell.
export function formatDataBlock(data: string | null): string {
  return data === null ? '' : `\n\n\`\`\`json\n${data}\n\`\`\`\n\n`;
}
