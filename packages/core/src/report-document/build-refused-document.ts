import type { UploadRefusal } from '../evidence/pick-upload-refusal.ts';
import { buildFileKey } from './build-linked-document.ts';
import type { ReportDocument } from './report-document.ts';

// The document with each refusal the upload guard gave in place, so a plan sizes a refused file as a
// local cell.
export function buildRefusedDocument(
  document: ReportDocument,
  refusals: ReadonlyMap<string, UploadRefusal['reason']>,
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
            refusal: refusals.get(buildFileKey(file.evidence)) ?? file.refusal,
          })),
        })),
      },
    ]),
  );

  return { ...document, journeys };
}
