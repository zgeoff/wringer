import type { ReportDocument } from './report-document.ts';

// The document as a dry run prints it: every journey that would upload keeps its evidence local,
// with the note that says why.
export function buildLocalDocument(document: ReportDocument): ReportDocument {
  const journeys = new Map(
    [...document.journeys].map(([name, journey]) => [
      name,
      journey.evidence === 'upload' ? { ...journey, evidence: 'no-upload-flag' as const } : journey,
    ]),
  );

  return { ...document, journeys };
}
