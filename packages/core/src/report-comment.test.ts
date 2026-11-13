import { expect, test } from 'bun:test';
import { parseReportComment, renderReportComment, toReportComment } from './report-comment.ts';
import type { Report, Verdict } from './report-schema.ts';

function setupTest() {
  const at = '2026-11-04T10:00:00.000Z';
  const base = 'origin/main';

  const buildVerdict = (feature: string, evidenceCount = 1, target = 'local'): Verdict => ({
    feature,
    fingerprint: 'b'.repeat(40),
    featureFingerprint: 'a'.repeat(40),
    run: 'r1',
    at,
    target: { name: target, evidence: 'local' },
    pin: { kind: 'local' },
    evidence: Array.from({ length: evidenceCount }, (_unused, index) => ({
      kind: 'note',
      path: `evidence/${feature}/note-${index}.txt`,
      sha256: 'c'.repeat(64),
    })),
  });

  const buildReport = (verdicts: readonly Verdict[]): Report => ({
    base,
    fingerprint: 'b'.repeat(40),
    complete: true,
    features: verdicts.map((verdict) => ({
      name: verdict.feature,
      changed: true,
      status: 'verified',
      verdict,
    })),
    unmapped: [],
  });

  return { buildVerdict, buildReport };
}

test('it round-trips claims whose names hold <, >, -- and a backtick, and the text holds none', () => {
  const ctx = setupTest();
  const name = 'a<b>c--d---e`f';
  const report = ctx.buildReport([ctx.buildVerdict(name, 1, 'x<y>--`z')]);
  const comment = toReportComment(report, 'shop');
  const text = renderReportComment(comment);
  const inner = text.slice('<!-- wringer-data v2 '.length, -' -->'.length);

  expect({
    forbidden: /--|<|>|`/u.test(inner),
    opener: text.startsWith('<!-- wringer-data v2 '),
    closer: text.endsWith(' -->'),
    read: parseReportComment(`Ships it.\n\n${text}\n`),
  }).toStrictEqual({
    forbidden: false,
    opener: true,
    closer: true,
    read: { ok: true, comment },
  });
});

test('it holds one claim per verdict, with a digest and a count in place of the evidence', () => {
  const ctx = setupTest();
  const verdict = ctx.buildVerdict('cart', 2);
  const report = ctx.buildReport([verdict]);

  report.features.push({ name: 'search', changed: false, status: 'unchanged', verdict: null });

  const comment = toReportComment(report, 'shop');

  const digest = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(verdict.evidence.map((item) => [item.kind, item.path, item.sha256])))
    .digest('hex');

  const { evidence: _evidence, ...claim } = verdict;

  expect(comment).toStrictEqual({
    version: 2,
    registry: 'shop',
    base: 'origin/main',
    fingerprint: 'b'.repeat(40),
    claims: [{ ...claim, evidenceDigest: digest, evidenceCount: 2 }],
  });
});

test('it keeps a comment for 30 features with 200 evidence files each under 32,000 characters', () => {
  const ctx = setupTest();

  const report = ctx.buildReport(
    Array.from({ length: 30 }, (_unused, index) => ctx.buildVerdict(`feature-${index}`, 200)),
  );

  const text = renderReportComment(toReportComment(report, 'shop'));

  expect(text.length).toBeLessThan(32_000);
});

test('it throws internal on a claim over 1,000 characters once escaped', () => {
  const ctx = setupTest();
  const report = ctx.buildReport([ctx.buildVerdict('<'.repeat(64), 1, '<'.repeat(64))]);

  expect(() => toReportComment(report, 'shop')).toThrow(/internal|1,000/u);
});

test.each([
  ['no comment and no version 1 block', 'Ships it.', 'none'],
  ['a version 1 block and no data comment', '<!-- wringer-report v1\n{}\n-->', 'version-1'],
  ['a comment from a newer version', '<!-- wringer-data v3 {} -->', 'newer-version'],
  ['an unclosed comment', '<!-- wringer-data v2 {"version":2}', 'unclosed'],
  ['a comment that is not JSON', '<!-- wringer-data v2 nope -->', 'invalid'],
  ['a comment that fails the schema', '<!-- wringer-data v2 {"version":2} -->', 'invalid'],
])('it refuses a body with %s', (_name, body, reason) => {
  const read = parseReportComment(body);
  const actual: string | null = read.ok ? null : read.reason;

  expect(actual).toBe(reason);
});

test('it refuses a body with two version 2 comments', () => {
  const ctx = setupTest();
  const text = renderReportComment(toReportComment(ctx.buildReport([]), 'shop'));
  const read = parseReportComment(`${text}\n${text}`);
  const actual: string | null = read.ok ? null : read.reason;

  expect(actual).toBe('several');
});

test('it reads the version 2 comment and ignores a version 1 block beside it', () => {
  const ctx = setupTest();
  const comment = toReportComment(ctx.buildReport([]), 'shop');

  const read = parseReportComment(
    `<!-- wringer-report v1\n{}\n-->\n${renderReportComment(comment)}`,
  );

  expect(read).toStrictEqual({ ok: true, comment });
});

test('it refuses a comment that names one feature twice, or adds a field', () => {
  const ctx = setupTest();
  const comment = toReportComment(ctx.buildReport([ctx.buildVerdict('cart')]), 'shop');
  const [claim] = comment.claims;

  const bodies = [
    { ...comment, claims: [claim, claim] },
    { ...comment, extra: true },
  ].map((value) => `<!-- wringer-data v2 ${JSON.stringify(value)} -->`);

  expect(bodies.map((body) => parseReportComment(body).ok)).toStrictEqual([false, false]);
});
