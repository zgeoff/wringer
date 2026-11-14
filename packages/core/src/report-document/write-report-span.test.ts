import { expect, test } from 'bun:test';
import { reportMarkers } from './report-markers.ts';
import { writeReportSpan } from './write-report-span.ts';

function setupTest() {
  return {
    block: `${reportMarkers.open}\nrow one\nrow two\n${reportMarkers.close}`,
    otherBlock: `${reportMarkers.open}\nnew\n${reportMarkers.close}`,
  };
}

test('#writeReportSpan puts a new span at the end of the Verification section with a blank line on each side', () => {
  const ctx = setupTest();
  const body = 'Intro\n\n## Verification\n\n- [x] ran it\n\n## Notes\n\nmore\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\n\n## Verification\n\n- [x] ran it\n\n${ctx.block}\n\n## Notes\n\nmore\n`,
  });
});

test('#writeReportSpan keeps blank lines and a heading directly after the section content', () => {
  const ctx = setupTest();
  const body = '## Verification\ntext\n## Notes\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\ntext\n\n${ctx.block}\n\n## Notes\n`,
  });
});

test('#writeReportSpan puts the span in a Verification section that ends the description', () => {
  const ctx = setupTest();

  expect(writeReportSpan('## Verification\n\ntext', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\ntext\n\n${ctx.block}`,
  });

  expect(writeReportSpan('## Verification\n\ntext\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\ntext\n\n${ctx.block}\n`,
  });
});

test('#writeReportSpan puts the span under an empty Verification heading', () => {
  const ctx = setupTest();

  expect(writeReportSpan('## Verification\n\n## Notes\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\n${ctx.block}\n\n## Notes\n`,
  });
});

test('#writeReportSpan keeps a level 3 heading inside the Verification section', () => {
  const ctx = setupTest();
  const body = '## Verification\n\n### Checks\n\nlist\n\n# Top\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\n### Checks\n\nlist\n\n${ctx.block}\n\n# Top\n`,
  });
});

test('#writeReportSpan matches a Verification heading with indent and closing hashes', () => {
  const ctx = setupTest();

  expect(writeReportSpan('  ## Verification ##\nx\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `  ## Verification ##\nx\n\n${ctx.block}\n`,
  });
});

test('#writeReportSpan writes the block in CRLF into a CRLF description and keeps every other byte', () => {
  const ctx = setupTest();
  const body = 'Intro\r\n\r\n## Verification\r\n\r\n- [x] ran it\r\n\r\n## Notes\r\n';
  const crlfBlock = ctx.block.replaceAll('\n', '\r\n');

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\r\n\r\n## Verification\r\n\r\n- [x] ran it\r\n\r\n${crlfBlock}\r\n\r\n## Notes\r\n`,
  });
});

test('#writeReportSpan writes the block in LF into an LF description when the block arrives in CRLF', () => {
  const ctx = setupTest();
  const crlfBlock = ctx.block.replaceAll('\n', '\r\n');

  expect(writeReportSpan('## Verification\nx\n', crlfBlock)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\nx\n\n${ctx.block}\n`,
  });
});

test.each([
  ['LF', '\n'],
  ['CRLF', '\r\n'],
])('#writeReportSpan replaces the span where it stands in a %s description', (_name, eol) => {
  const ctx = setupTest();
  const before = `Intro${eol}${eol}## Verification${eol}${eol}`;
  const after = `${eol}${eol}## Notes${eol}tail  ${eol}`;
  const oldSpan = `${reportMarkers.open}${eol}old${eol}${reportMarkers.close}`;
  const newSpan = ctx.otherBlock.replaceAll('\n', eol);

  expect(writeReportSpan(`${before}${oldSpan}${after}`, ctx.otherBlock)).toStrictEqual({
    ok: true,
    action: 'replaced',
    body: `${before}${newSpan}${after}`,
  });
});

test('#writeReportSpan replaces a span that sits outside the Verification section', () => {
  const ctx = setupTest();
  const body = `${ctx.block}\n\n## Verification\n\nx\n`;

  expect(writeReportSpan(body, ctx.otherBlock)).toStrictEqual({
    ok: true,
    action: 'replaced',
    body: `${ctx.otherBlock}\n\n## Verification\n\nx\n`,
  });
});

test('#writeReportSpan leaves the description as it was when the span already holds the ctx.block', () => {
  const ctx = setupTest();
  const body = `## Verification\n\n${ctx.block}\n\nend\n`;

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({ ok: true, action: 'unchanged', body });
});

test('#writeReportSpan reports unchanged for a CRLF description whose span holds the block in LF', () => {
  const ctx = setupTest();
  const body = `## Verification\r\n\r\n${ctx.block.replaceAll('\n', '\r\n')}\r\n`;
  const lfSpanBody = `## Verification\r\n\r\n${ctx.block}\r\n`;

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({ ok: true, action: 'unchanged', body });

  expect(writeReportSpan(lfSpanBody, ctx.block)).toStrictEqual({
    ok: true,
    action: 'unchanged',
    body: lfSpanBody,
  });
});

test('#writeReportSpan appends a Verification heading with the span when the description has none', () => {
  const ctx = setupTest();

  expect(writeReportSpan('Intro\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\n\n## Verification\n\n${ctx.block}`,
  });

  expect(writeReportSpan('Intro', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\n\n## Verification\n\n${ctx.block}`,
  });

  expect(writeReportSpan('Intro\n\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\n\n## Verification\n\n${ctx.block}`,
  });
});

test('#writeReportSpan appends the heading in CRLF to a CRLF description', () => {
  const ctx = setupTest();

  expect(writeReportSpan('Intro\r\n', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `Intro\r\n\r\n## Verification\r\n\r\n${ctx.block.replaceAll('\n', '\r\n')}`,
  });
});

test('#writeReportSpan writes the heading and span alone into an empty description', () => {
  const ctx = setupTest();

  expect(writeReportSpan('', ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\n${ctx.block}`,
  });
});

test.each([
  ['backtick', '```', '```'],
  ['tilde', '~~~', '~~~'],
  ['indented backtick', '   ```', '   ```'],
  ['long backtick', '````', '`````'],
  ['backtick with an info string', '```md', '```'],
])('#writeReportSpan skips a Verification heading inside a %s fence', (_name, opening, closing) => {
  const ctx = setupTest();
  const body = `${opening}\n## Verification\n${closing}\n\nafter\n`;

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `${body}\n## Verification\n\n${ctx.block}`,
  });
});

test('#writeReportSpan ends the section at a heading, and ignores a heading inside a fence', () => {
  const ctx = setupTest();
  const body = '## Verification\n\n```md\n## Notes\n```\n\n~~~\n# Top\n~~~\n\n## Notes\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\n\`\`\`md\n## Notes\n\`\`\`\n\n~~~\n# Top\n~~~\n\n${ctx.block}\n\n## Notes\n`,
  });
});

test('#writeReportSpan treats a fence closed by a shorter or different fence as still open', () => {
  const ctx = setupTest();
  const body = '````\n```\n~~~\n## Verification\n````\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `${body}\n## Verification\n\n${ctx.block}`,
  });
});

test('#writeReportSpan skips markers inside fences and replaces the span outside them', () => {
  const ctx = setupTest();
  const fenced = `\`\`\`\n${reportMarkers.open}\n${reportMarkers.open}\n${reportMarkers.close}\n\`\`\`\n`;
  const body = `${fenced}\n## Verification\n\n${ctx.block}\n\n~~~\n${reportMarkers.close}\n~~~\n`;

  expect(writeReportSpan(body, ctx.otherBlock)).toStrictEqual({
    ok: true,
    action: 'replaced',
    body: `${fenced}\n## Verification\n\n${ctx.otherBlock}\n\n~~~\n${reportMarkers.close}\n~~~\n`,
  });
});

test('#writeReportSpan creates a span when the only markers sit inside a fence', () => {
  const ctx = setupTest();
  const body = `## Verification\n\n\`\`\`\n${ctx.block}\n\`\`\`\n`;

  expect(writeReportSpan(body, ctx.otherBlock)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `${body}\n${ctx.otherBlock}\n`,
  });
});

test('#writeReportSpan counts a marker after a closed fence', () => {
  const ctx = setupTest();
  const body = `\`\`\`\nx\n\`\`\`\n${reportMarkers.open}\n`;

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: false,
    reason: 'The description holds an opening wringer report marker and no closing one.',
  });
});

test.each([
  [
    'two opening markers',
    `${reportMarkers.open}\n${reportMarkers.open}\n${reportMarkers.close}`,
    'The description holds 2 opening wringer report markers; it must hold one.',
  ],
  [
    'two closing markers',
    `${reportMarkers.open}\n${reportMarkers.close}\n${reportMarkers.close}`,
    'The description holds 2 closing wringer report markers; it must hold one.',
  ],
  [
    'an opening marker alone',
    `text\n${reportMarkers.open}\n`,
    'The description holds an opening wringer report marker and no closing one.',
  ],
  [
    'a closing marker alone',
    `text\n${reportMarkers.close}\n`,
    'The description holds a closing wringer report marker and no opening one.',
  ],
  [
    'the closing marker before the opening one',
    `${reportMarkers.close}\n${reportMarkers.open}\n`,
    'The description holds a closing wringer report marker before the opening one.',
  ],
])('#writeReportSpan refuses %s', (_name, body, reason) => {
  const ctx = setupTest();

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({ ok: false, reason });
});

test('#writeReportSpan refuses a Verification section that ends inside a fence that never closes', () => {
  const ctx = setupTest();
  const body = '## Verification\n\n```\ncode\n';

  expect(writeReportSpan(body, ctx.block)).toStrictEqual({
    ok: false,
    reason:
      'The description ends inside a code block that never closes, so the report has no place outside it.',
  });
});

test.each([
  ['no markers', 'just text'],
  ['no closing marker', `${reportMarkers.open}\nrows`],
  ['text before the opening marker', `x ${reportMarkers.open}\nrows\n${reportMarkers.close}`],
  [
    'two spans',
    `${reportMarkers.open}${reportMarkers.close}\n${reportMarkers.open}${reportMarkers.close}`,
  ],
])('#writeReportSpan refuses a block with %s', (_name, badBlock) => {
  expect(writeReportSpan('## Verification\n', badBlock)).toStrictEqual({
    ok: false,
    reason: 'The report block must start with one opening marker and end with one closing marker.',
  });
});

test.each([
  ['a backtick fence', '```'],
  ['a tilde fence', '~~~'],
  ['an indented fence', '  ```'],
])('#writeReportSpan refuses a block whose closing marker sits in %s left open', (_name, fence) => {
  const badBlock = `${reportMarkers.open}\n${fence}\nrow\n${reportMarkers.close}`;

  expect(writeReportSpan('## Verification\n\n## Notes\ntext\n', badBlock)).toStrictEqual({
    ok: false,
    reason: 'The report block leaves a code block open at its closing marker.',
  });
});

test('#writeReportSpan accepts a block whose fence closes before the closing marker', () => {
  const block = `${reportMarkers.open}\n\`\`\`\nrow\n\`\`\`\n${reportMarkers.close}`;

  expect(writeReportSpan('## Verification\n', block)).toStrictEqual({
    ok: true,
    action: 'created',
    body: `## Verification\n\n${block}\n`,
  });
});
