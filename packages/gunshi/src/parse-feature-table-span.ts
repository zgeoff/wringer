const featuresOpenMarker = '<!-- wringer:features -->';
const featuresCloseMarker = '<!-- /wringer:features -->';

export type FeatureTableSpan =
  | { readonly ok: true; readonly line: number; readonly table: string }
  | { readonly ok: false; readonly line: number; readonly reason: string };

// The feature table that SKILL.md holds between its two markers, with the blank lines around it
// trimmed, and the line of the opening marker.
export function parseFeatureTableSpan(text: string): FeatureTableSpan {
  const open = text.indexOf(featuresOpenMarker);

  if (open === -1) {
    return { ok: false, line: 1, reason: `SKILL.md has no \`${featuresOpenMarker}\` marker.` };
  }

  const line = text.slice(0, open).split('\n').length;
  const bodyStart = open + featuresOpenMarker.length;
  const close = text.indexOf(featuresCloseMarker, bodyStart);

  if (close === -1) {
    return { ok: false, line, reason: `SKILL.md has no \`${featuresCloseMarker}\` marker.` };
  }

  return {
    ok: true,
    line,
    table: text
      .slice(bodyStart, close)
      .replaceAll('\r\n', '\n')
      .replaceAll(/^\n+|\n+$/gu, ''),
  };
}

const delimiterRowIndex = 1;

// The table without the column padding that a Markdown formatter adds: each row's cells trimmed,
// and each cell of the delimiter row cut to three dashes. An escaped pipe stays inside its cell.
export function toComparableTable(table: string): string {
  return table
    .split('\n')
    .map((row, index) =>
      row
        .trim()
        .split(/(?<!\\)\|/u)
        .map((cell) => toComparableCell(cell, index === delimiterRowIndex))
        .join('|'),
    )
    .join('\n');
}

function toComparableCell(cell: string, isDelimiter: boolean): string {
  const trimmed = cell.trim();

  return isDelimiter ? trimmed.replace(/^:?-+:?$/u, '---') : trimmed;
}
