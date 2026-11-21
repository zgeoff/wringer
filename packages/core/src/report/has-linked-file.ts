import type { ReportDocument } from '../report-document/report-document.ts';
import { collectShownEntries } from '../report-plan/collect-shown-files.ts';
import type { ReportPlan } from '../report-plan/report-plan.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { formatReportLink } from './format-report-link.ts';

// Whether the report, as the plan cuts it, shows a link to any evidence file.
export function hasLinkedFile(
  document: ReportDocument,
  plan: ReportPlan,
  secrets: SecretSet,
): boolean {
  return collectShownEntries(document, plan).some(
    (entry) =>
      entry.file.url !== null &&
      formatReportLink(entry.file.url, document.linkHosts, secrets) !== null,
  );
}
