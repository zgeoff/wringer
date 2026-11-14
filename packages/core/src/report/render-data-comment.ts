import { renderReportComment, toReportComment } from '../report-document/parse-report-comment.ts';
import type { ReportDocument } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { reportSchema } from '../verdict/report-schema.ts';

// The comment's JSON escaping turns `<` into `<`, so a secret that holds `<` no longer matches
// afterwards. The secret set scrubs the report and the registry first, while the text is raw.
export function renderDataComment(document: ReportDocument, secrets: SecretSet): string {
  const report = reportSchema.parse(secrets.scrubValue(document.report));

  return renderReportComment(toReportComment(report, secrets.scrubText(document.registry)));
}
