import { reportMarkers } from './report-markers.ts';
import { writeReportSpan } from './write-report-span.ts';

// GitHub refuses a description longer than this many UTF-16 code units, and the budget keeps a
// margin below it.
export const maxDescriptionChars = 65_536;
const marginChars = 1024;

export type SpanBudget =
  | { readonly ok: true; readonly budgetChars: number }
  | { readonly ok: false; readonly reason: string };

// The characters the report span may use in a description: the limit, less every character outside
// the span after a block goes in, less the margin. A block with no body shows what the writer adds
// around a new span, and what stays around an old one.
export function resolveSpanBudget(body: string): SpanBudget {
  const probe = `${reportMarkers.open}\n${reportMarkers.close}`;
  const edit = writeReportSpan(body, probe);

  if (!edit.ok) {
    return edit;
  }

  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n';
  const probeChars = probe.replaceAll('\n', lineEnding).length;
  const outsideChars = edit.body.length - probeChars;

  return { ok: true, budgetChars: Math.max(0, maxDescriptionChars - outsideChars - marginChars) };
}
