import type { ReportDocument } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { formatReportLink } from './format-report-link.ts';

// Whether the report links any evidence file of its features.
export function hasLinkedFile(document: ReportDocument, secrets: SecretSet): boolean {
  return document.report.features.some((feature) =>
    (document.journeys.get(feature.name)?.steps ?? []).some((step) =>
      step.files.some(
        (file) =>
          file.url !== null && formatReportLink(file.url, document.linkHosts, secrets) !== null,
      ),
    ),
  );
}
