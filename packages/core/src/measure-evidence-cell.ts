import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { isRasterFile } from './is-raster-file.ts';
import { pickCellFiles } from './pick-cell-files.ts';
import { renderEvidenceCell } from './render-evidence-cell.ts';
import type { JourneyFile } from './report-document.ts';

export interface CellSizing {
  // The rendered length of every link; a file with a `url` is sized as a link of this length.
  readonly linkChars: number;
  readonly shortened: boolean;
}

// The length that `renderEvidenceCell` gives, with each linked file counted at `linkChars` and no
// link text rendered, so a secret that overlaps a stand-in link cannot change the length.
export function measureEvidenceCell(
  files: readonly JourneyFile[],
  secrets: SecretSet,
  sizing: CellSizing,
): number {
  const cell = pickCellFiles(files, sizing.shortened);
  const parts = cell.kept.map((file) => measureFile(file, secrets, sizing.linkChars));
  const hiddenChars = cell.hidden > 0 ? `+${cell.hidden} more`.length : 0;
  const partCount = parts.length + (cell.hidden > 0 ? 1 : 0);
  const separators = '<br>'.length * Math.max(0, partCount - 1);

  return parts.reduce((sum, chars) => sum + chars, 0) + hiddenChars + separators;
}

function measureFile(file: JourneyFile, secrets: SecretSet, linkChars: number): number {
  if (file.url === null) {
    return renderEvidenceCell([file], [], secrets, false).length;
  }

  if (isRasterFile(file)) {
    return '<img src="" width="320" />'.length + linkChars;
  }

  return (
    `<a href=""></a>`.length + linkChars + escapeReportText(file.evidence.kind, secrets).length
  );
}
