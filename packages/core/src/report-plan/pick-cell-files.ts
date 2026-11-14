import type { JourneyFile } from '../report-document/report-document.ts';
import { isRasterFile } from '../report/is-raster-file.ts';
import { reportCutLimits } from './report-cut-limits.ts';

export interface CellFiles {
  readonly kept: readonly JourneyFile[];
  readonly hidden: number;
}

// The files an Evidence cell shows. A shortened cell keeps the images first and shows its files in
// their own order.
export function pickCellFiles(files: readonly JourneyFile[], shortened: boolean): CellFiles {
  if (!shortened || files.length < reportCutLimits.shortenFromFiles) {
    return { kept: files, hidden: 0 };
  }

  const ranked = files
    .map((file, index) => ({ file, index, isImage: isRasterFile(file) }))
    .toSorted(
      (left, right) => Number(right.isImage) - Number(left.isImage) || left.index - right.index,
    )
    .slice(0, reportCutLimits.keptFiles)
    .toSorted((left, right) => left.index - right.index);

  return { kept: ranked.map((entry) => entry.file), hidden: files.length - ranked.length };
}
