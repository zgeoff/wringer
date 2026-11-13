import { expect, test } from 'bun:test';
import { parseReportBlock } from './parse-report-block.ts';

test('it returns the block under the Verification heading', () => {
  const body = `## Summary\n\nText\n\n## Verification\n\n- [x] ran\n\n<!-- wringer:report -->\nrows\n<!-- /wringer:report -->\n\n## Notes\n`;

  expect(parseReportBlock(body)).toStrictEqual({
    ok: true,
    block: `<!-- wringer:report -->\nrows\n<!-- /wringer:report -->`,
  });
});

test('it reads a description with CRLF line endings', () => {
  const body = `## Verification\r\n<!-- wringer:report -->\r\nrows\r\n<!-- /wringer:report -->\r\n`;

  expect(parseReportBlock(body)).toStrictEqual({
    ok: true,
    block: `<!-- wringer:report -->\nrows\n<!-- /wringer:report -->`,
  });
});

test.each([
  ['an empty description', ''],
  ['a description with other text', '## Verification\n\nNothing yet\n'],
  [
    'markers inside a fenced block',
    `## Verification\n\n\`\`\`\n<!-- wringer:report -->\n<!-- /wringer:report -->\n\`\`\`\n`,
  ],
])('it reports no block for %s', (_name, body) => {
  expect(parseReportBlock(body)).toStrictEqual({
    ok: false,
    detail: 'the description holds no wringer report block',
  });
});

test('it reports two opening markers', () => {
  const body = `## Verification\n<!-- wringer:report -->\n<!-- /wringer:report -->\n<!-- wringer:report -->\n`;

  expect(parseReportBlock(body)).toStrictEqual({
    ok: false,
    detail:
      'the description holds 2 opening and 1 closing report markers; it must hold one of each',
  });
});

test('it reports a closing marker before the opening one', () => {
  const body = `## Verification\n<!-- /wringer:report -->\n<!-- wringer:report -->\n`;

  expect(parseReportBlock(body)).toStrictEqual({
    ok: false,
    detail: 'the closing report marker comes before the opening one',
  });
});

test('it reports a block outside the Verification section', () => {
  const body = `## Verification\n\n## Notes\n<!-- wringer:report -->\n<!-- /wringer:report -->\n`;

  expect(parseReportBlock(body)).toStrictEqual({
    ok: false,
    detail: 'the report block is not under the ## Verification heading',
  });
});

test('it reports a block in a description without a Verification heading', () => {
  expect(parseReportBlock(`<!-- wringer:report -->\n<!-- /wringer:report -->\n`)).toStrictEqual({
    ok: false,
    detail: 'the report block is not under the ## Verification heading',
  });
});
