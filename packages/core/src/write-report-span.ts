import { collectFencedRanges } from './collect-fenced-ranges.ts';
import type { FencedRange } from './collect-fenced-ranges.ts';
import { collectLines } from './collect-lines.ts';
import { reportMarkers } from './report-markers.ts';

export type ReportSpanEdit =
  | {
      readonly ok: true;
      readonly body: string;
      readonly action: 'created' | 'replaced' | 'unchanged';
    }
  | { readonly ok: false; readonly reason: string };

// Pure: the description in, the description with the block in place out. The block holds its own
// opening and closing markers.
export function writeReportSpan(body: string, block: string): ReportSpanEdit {
  const span = block.trim();
  const blockProblem = findBlockProblem(span);

  if (blockProblem !== null) {
    return { ok: false, reason: blockProblem };
  }

  const fenced = collectFencedRanges(body);
  const opens = collectMarkerOffsets(body, reportMarkers.open, fenced);
  const closes = collectMarkerOffsets(body, reportMarkers.close, fenced);
  const markerProblem = findMarkerProblem(opens, closes);

  if (markerProblem !== null) {
    return { ok: false, reason: markerProblem };
  }

  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n';
  const text = toLineEnding(span, lineEnding);
  const [opening] = opens;
  const [closing] = closes;

  if (opening !== undefined && closing !== undefined) {
    const spanEnd = closing + reportMarkers.close.length;

    if (toLineEnding(body.slice(opening, spanEnd), '\n') === toLineEnding(span, '\n')) {
      return { ok: true, body, action: 'unchanged' };
    }

    return {
      ok: true,
      body: body.slice(0, opening) + text + body.slice(spanEnd),
      action: 'replaced',
    };
  }

  const created = createSpan(body, text, lineEnding, fenced);

  if (
    collectMarkerOffsets(created, reportMarkers.open, collectFencedRanges(created)).length !== 1
  ) {
    return {
      ok: false,
      reason:
        'The description ends inside a code block that never closes, so the report has no place outside it.',
    };
  }

  return { ok: true, body: created, action: 'created' };
}

function findBlockProblem(span: string): string | null {
  const opens = span.split(reportMarkers.open).length - 1;
  const closes = span.split(reportMarkers.close).length - 1;

  if (
    opens !== 1 ||
    closes !== 1 ||
    !span.startsWith(reportMarkers.open) ||
    !span.endsWith(reportMarkers.close)
  ) {
    return 'The report block must start with one opening marker and end with one closing marker.';
  }

  if (isFenced(collectFencedRanges(span), span.length - reportMarkers.close.length)) {
    return 'The report block leaves a code block open at its closing marker.';
  }

  return null;
}

function isFenced(fenced: readonly FencedRange[], offset: number): boolean {
  return fenced.some((range) => offset >= range.start && offset < range.end);
}

function collectMarkerOffsets(
  body: string,
  marker: string,
  fenced: readonly FencedRange[],
): number[] {
  const offsets: number[] = [];
  let from = body.indexOf(marker);

  while (from !== -1) {
    if (!isFenced(fenced, from)) {
      offsets.push(from);
    }

    from = body.indexOf(marker, from + marker.length);
  }

  return offsets;
}

function findMarkerProblem(opens: readonly number[], closes: readonly number[]): string | null {
  const [opening] = opens;
  const [closing] = closes;

  if (opens.length > 1) {
    return `The description holds ${opens.length} opening wringer report markers; it must hold one.`;
  }

  if (closes.length > 1) {
    return `The description holds ${closes.length} closing wringer report markers; it must hold one.`;
  }

  if (opening !== undefined && closing === undefined) {
    return 'The description holds an opening wringer report marker and no closing one.';
  }

  if (opening === undefined && closing !== undefined) {
    return 'The description holds a closing wringer report marker and no opening one.';
  }

  if (opening !== undefined && closing !== undefined && closing < opening) {
    return 'The description holds a closing wringer report marker before the opening one.';
  }

  return null;
}

function toLineEnding(text: string, lineEnding: string): string {
  return text.replaceAll(/\r?\n/gu, lineEnding);
}

const verificationTitle = 'Verification';

function createSpan(
  body: string,
  text: string,
  lineEnding: string,
  fenced: readonly FencedRange[],
): string {
  const section = findVerificationSection(body, fenced);

  if (section === null) {
    const trailingNewlines = (/(?:\r?\n)*$/u.exec(body)?.[0].split('\n').length ?? 1) - 1;
    const gap = body === '' ? '' : lineEnding.repeat(Math.max(0, 2 - trailingNewlines));

    return `${body}${gap}## ${verificationTitle}${lineEnding}${lineEnding}${text}`;
  }

  const before = body.slice(0, section.insertAt);
  const after = body.slice(section.insertAt);
  const headingFollows = hasContentRightAfterLineEnding(after);

  return `${before}${lineEnding}${lineEnding}${text}${headingFollows ? lineEnding : ''}${after}`;
}

const headingPattern = /^ {0,3}(?<hashes>#{1,6})(?:[ \t]+(?<title>.*?))?(?:[ \t]+#+)?[ \t]*$/u;

// The offset just past the last non-blank line of the first Verification section, which ends
// before the next heading of level 2 or less.
function findVerificationSection(
  body: string,
  fenced: readonly FencedRange[],
): { readonly insertAt: number } | null {
  let insertAt: number | null = null;

  for (const line of collectLines(body)) {
    if (isFenced(fenced, line.start)) {
      if (insertAt !== null) {
        insertAt = line.start + line.text.length;
      }

      continue;
    }

    const heading = headingPattern.exec(line.text)?.groups;
    const level = heading?.['hashes']?.length ?? 7;

    if (insertAt === null) {
      if (level === 2 && heading?.['title'] === verificationTitle) {
        insertAt = line.start + line.text.length;
      }

      continue;
    }

    if (level <= 2) {
      break;
    }

    if (line.text.trim() !== '') {
      insertAt = line.start + line.text.length;
    }
  }

  return insertAt === null ? null : { insertAt };
}

function hasContentRightAfterLineEnding(after: string): boolean {
  const [, next] = collectLines(after);

  return next !== undefined && next.text.trim() !== '';
}
