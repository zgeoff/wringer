import type { Evidence } from '../envelope/envelope.ts';
import type { ReportDocument } from './report-document.ts';

// Names a file by its path and hash, the way a link is looked up.
export function buildFileKey(evidence: Evidence): string {
  return `${evidence.path}\0${evidence.sha256}`;
}

// The document with each uploaded file's link in place. A file with no link stays local.
export function buildLinkedDocument(
  document: ReportDocument,
  links: ReadonlyMap<string, string>,
): ReportDocument {
  const journeys = new Map(
    [...document.journeys].map(([name, journey]) => [
      name,
      {
        ...journey,
        steps: journey.steps.map((step) => ({
          ...step,
          files: step.files.map((file) => ({
            ...file,
            url: links.get(buildFileKey(file.evidence)) ?? null,
          })),
        })),
      },
    ]),
  );

  return { ...document, journeys };
}
