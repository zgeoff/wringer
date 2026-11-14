import { basename } from 'node:path';
import type { JourneyFile } from '../report-document/report-document.ts';
import { pickCellFiles } from '../report-plan/pick-cell-files.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatReportLink } from './format-report-link.ts';
import { isRasterFile } from './is-raster-file.ts';

// One step's files: a raster image as an image, any other uploaded file as a link named by its
// kind, and a file that stayed local by its name and size. A shortened cell names how many files
// it leaves out.
export function renderEvidenceCell(
  files: readonly JourneyFile[],
  linkHosts: readonly string[],
  secrets: SecretSet,
  shortened: boolean,
): string {
  const cell = pickCellFiles(files, shortened);
  const parts = cell.kept.map((file) => renderFile(file, linkHosts, secrets));

  return (cell.hidden > 0 ? [...parts, `+${cell.hidden} more`] : parts).join('<br>');
}

function renderFile(file: JourneyFile, linkHosts: readonly string[], secrets: SecretSet): string {
  const link = file.url === null ? null : formatReportLink(file.url, linkHosts, secrets);

  if (link === null) {
    return renderLocalFile(file, secrets);
  }

  return isRasterFile(file)
    ? `<img src="${link}" width="320" />`
    : `<a href="${link}">${escapeReportText(file.evidence.kind, secrets)}</a>`;
}

function renderLocalFile(file: JourneyFile, secrets: SecretSet): string {
  const name = escapeReportText(basename(file.evidence.path), secrets);

  return file.bytes === null ? `${name} (missing)` : `${name} (${formatSize(file.bytes)})`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
