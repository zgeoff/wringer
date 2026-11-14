import { reportCommentSchema } from '../verdict/report-schema.ts';
import type { Claim, Report, ReportComment, Verdict } from '../verdict/report-schema.ts';
import { WringerError } from '../wringer-error.ts';

const commentOpen = '<!-- wringer-data v2 ';
const commentClose = ' -->';
const versionOneOpen = '<!-- wringer-report v1';
const maxClaimLength = 1000;

export type CommentRead =
  | { readonly ok: true; readonly comment: ReportComment }
  | {
      readonly ok: false;
      readonly reason: 'none' | 'version-1' | 'newer-version' | 'several' | 'unclosed' | 'invalid';
      readonly message: string;
    };

export function parseReportComment(body: string): CommentRead {
  const found = [...body.matchAll(/<!-- wringer-data v(?<version>\d+)/gu)].map((match) => ({
    version: Number(match.groups?.['version']),
    start: match.index,
  }));

  if (found.some((item) => item.version > 2)) {
    return {
      ok: false,
      reason: 'newer-version',
      message: 'The PR body holds a data comment from a newer wringer.',
    };
  }

  const current = found.filter((item) => item.version === 2);

  if (found.length > current.length) {
    return invalid('The PR body holds a data comment of an unknown version.');
  }

  if (current.length > 1) {
    return {
      ok: false,
      reason: 'several',
      message: 'The PR body holds more than one wringer data comment.',
    };
  }

  const [only] = current;

  if (only === undefined) {
    return body.includes(versionOneOpen)
      ? { ok: false, reason: 'version-1', message: 'The PR body holds a version 1 report.' }
      : { ok: false, reason: 'none', message: 'The PR body holds no wringer data comment.' };
  }

  if (!body.startsWith(commentOpen, only.start)) {
    return invalid('The wringer data comment does not open with its version and a space.');
  }

  const textStart = only.start + commentOpen.length;
  const end = body.indexOf(commentClose, textStart);

  if (end === -1) {
    return {
      ok: false,
      reason: 'unclosed',
      message: 'The wringer data comment in the PR body is not closed.',
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body.slice(textStart, end));
  } catch {
    return invalid('The wringer data comment does not hold valid JSON.');
  }

  const comment = reportCommentSchema.safeParse(parsed);

  return comment.success
    ? { ok: true, comment: comment.data }
    : invalid(`The wringer data comment does not match the schema: ${comment.error.message}`);
}

// One claim per verdict the report holds, with no path list.
export function toReportComment(report: Report, registry: string): ReportComment {
  const claims = report.features.flatMap((feature) =>
    feature.verdict === null ? [] : [toClaim(feature.verdict)],
  );

  for (const claim of claims) {
    if (escapeJSON(JSON.stringify(claim)).length > maxClaimLength) {
      throw new WringerError('internal', {
        message: `The claim of \`${claim.feature}\` is longer than ${maxClaimLength.toLocaleString('en-US')} characters once escaped.`,
      });
    }
  }

  return { version: 2, registry, base: report.base, fingerprint: report.fingerprint, claims };
}

// JSON Unicode escapes keep `<`, `>`, a backtick and `--` out of the text, so the comment cannot
// end early or open markup, and `JSON.parse` alone reads it back.
export function renderReportComment(comment: ReportComment): string {
  return `${commentOpen}${escapeJSON(JSON.stringify(comment))}${commentClose}`;
}

function invalid(message: string): CommentRead {
  return { ok: false, reason: 'invalid', message };
}

function toClaim(verdict: Verdict): Claim {
  const { evidence, ...rest } = verdict;

  const evidenceDigest = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(evidence.map((item) => [item.kind, item.path, item.sha256])))
    .digest('hex');

  return { ...rest, evidenceDigest, evidenceCount: evidence.length };
}

function escapeJSON(json: string): string {
  return json
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('>', String.raw`\u003e`)
    .replaceAll('`', String.raw`\u0060`)
    .replaceAll(/-(?=-)/gu, String.raw`\u002d`);
}
