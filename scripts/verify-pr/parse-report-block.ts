import { collectFencedRanges, reportMarkers } from '@wringer/core';
import type { FencedRange } from '@wringer/core';

export type ReportBlockRead =
  | { readonly ok: true; readonly block: string }
  | { readonly ok: false; readonly detail: string };

interface MarkerSite {
  readonly line: number;
  readonly section: string | null;
}

// Reads the one report block of a PR description. A marker or heading inside a fenced code block is
// the author's text and counts for nothing.
export function parseReportBlock(body: string): ReportBlockRead {
  const fenced = collectFencedRanges(body);
  const lines = collectLines(body);
  const opens: MarkerSite[] = [];
  const closes: MarkerSite[] = [];
  let section: string | null = null;

  for (const [index, line] of lines.entries()) {
    if (isFenced(fenced, line.start)) {
      continue;
    }

    const heading = /^ {0,3}(?<level>#{1,2})(?:[ \t]+(?<title>.*?))?[ \t#]*$/u.exec(line.text);

    if (heading !== null) {
      section = heading.groups?.['level']?.length === 2 ? (heading.groups['title'] ?? '') : null;
    }

    for (const [marker, sites] of [
      [reportMarkers.open, opens],
      [reportMarkers.close, closes],
    ] as const) {
      for (let found = 0; found < line.text.split(marker).length - 1; found += 1) {
        sites.push({ line: index, section });
      }
    }
  }

  const [open] = opens;
  const [close] = closes;

  if (opens.length === 0 && closes.length === 0) {
    return { ok: false, detail: 'the description holds no wringer report block' };
  }

  if (opens.length !== 1 || closes.length !== 1 || open === undefined || close === undefined) {
    return {
      ok: false,
      detail: `the description holds ${opens.length} opening and ${closes.length} closing report markers; it must hold one of each`,
    };
  }

  if (close.line < open.line || (close.line === open.line && !isInOrder(lines[open.line]?.text))) {
    return { ok: false, detail: 'the closing report marker comes before the opening one' };
  }

  if (open.section !== 'Verification' || close.section !== 'Verification') {
    return { ok: false, detail: 'the report block is not under the ## Verification heading' };
  }

  return {
    ok: true,
    block: lines
      .slice(open.line, close.line + 1)
      .map((line) => line.text)
      .join('\n'),
  };
}

function collectLines(body: string): { readonly start: number; readonly text: string }[] {
  let start = 0;

  return body.split('\n').map((line) => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    const site = { start, text };

    start += line.length + 1;

    return site;
  });
}

function isFenced(fenced: readonly FencedRange[], offset: number): boolean {
  return fenced.some((range) => offset >= range.start && offset < range.end);
}

function isInOrder(line: string | undefined): boolean {
  return (line?.indexOf(reportMarkers.open) ?? 0) < (line?.indexOf(reportMarkers.close) ?? 0);
}
