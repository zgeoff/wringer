import { expect, test } from 'bun:test';
import { parseReportBlock } from './parse-report-block.ts';
import { renderReportMarkdown } from './render-report-markdown.ts';
import type { Report } from './report-schema.ts';

test('it reads back the report that the Markdown embeds, with a > in a value', () => {
  const report: Report = {
    base: 'main',
    fingerprint: 'b'.repeat(40),
    complete: true,
    features: [
      {
        name: 'checkout',
        changed: true,
        status: 'verified',
        verdict: {
          feature: 'checkout',
          fingerprint: 'b'.repeat(40),
          featureFingerprint: 'a'.repeat(40),
          run: 'r1',
          at: '2026-11-04T10:00:00.000Z',
          target: { name: 'local', evidence: 'local' },
          pin: { kind: 'local' },
          evidence: [{ kind: 'note', path: 'a-->b.txt', sha256: 'a'.repeat(64) }],
        },
      },
    ],
    unmapped: [],
  };

  const parsed = parseReportBlock(`Ships the checkout.\n\n${renderReportMarkdown(report)}`);

  expect(parsed).toStrictEqual({ ok: true, report });
});

test('it explains a body that holds no report block', () => {
  const parsed = parseReportBlock('Ships the checkout.');

  expect(parsed).toStrictEqual({ ok: false, reason: 'The PR body holds no wringer report block.' });
});

test('it explains a block that does not hold JSON', () => {
  const parsed = parseReportBlock('<!-- wringer-report v1\nnot json\n-->');

  expect(parsed).toStrictEqual({
    ok: false,
    reason: 'The wringer report block does not hold valid JSON.',
  });
});

test('it explains a block whose JSON is not a report', () => {
  const parsed = parseReportBlock('<!-- wringer-report v1\n{"version":2}\n-->');

  expect(parsed).toStrictEqual({
    ok: false,
    reason: expect.stringMatching(/^The wringer report block does not match the report schema: /u),
  });
});
