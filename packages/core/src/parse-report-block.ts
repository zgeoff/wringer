import { reportBlockClose, reportBlockOpen } from './render-report-markdown.ts';
import { reportSchema } from './report-schema.ts';
import type { Report } from './report-schema.ts';

export type ReportBlockResult =
  | { readonly ok: true; readonly report: Report }
  | { readonly ok: false; readonly reason: string };

export function parseReportBlock(body: string): ReportBlockResult {
  const start = body.lastIndexOf(reportBlockOpen);

  if (start === -1) {
    return { ok: false, reason: 'The PR body holds no wringer report block.' };
  }

  const end = body.indexOf(reportBlockClose, start + reportBlockOpen.length);

  if (end === -1) {
    return { ok: false, reason: 'The wringer report block in the PR body is not closed.' };
  }

  const text = body.slice(start + reportBlockOpen.length, end).trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The wringer report block does not hold valid JSON.' };
  }

  const report = reportSchema.safeParse(parsed);

  return report.success
    ? { ok: true, report: report.data }
    : {
        ok: false,
        reason: `The wringer report block does not match the report schema: ${report.error.message}`,
      };
}
