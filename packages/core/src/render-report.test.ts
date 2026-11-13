import { expect, test } from 'bun:test';
import { createSecretSet } from './create-secret-set.ts';
import { renderReport } from './render-report.ts';
import { parseReportComment } from './report-comment.ts';
import type { JourneyFile, JourneyStep, LocalCause, ReportDocument } from './report-document.ts';
import { noCuts } from './report-plan.ts';
import type { Verdict } from './report-schema.ts';

interface DocumentOptions {
  readonly evidence?: 'upload' | LocalCause;
  readonly verdict?: Verdict;
  readonly linkHosts?: readonly string[];
  readonly unmapped?: readonly string[];
}

function setupTest() {
  const at = '2026-11-04T10:00:00.000Z';
  const digest = 'c'.repeat(64);
  const command = 'browser screenshot';
  const backslash = String.fromCodePoint(92);
  const secrets = createSecretSet();

  const buildVerdict = (overrides: Partial<Verdict> = {}): Verdict => ({
    feature: 'checkout',
    fingerprint: 'b'.repeat(40),
    featureFingerprint: 'a'.repeat(40),
    run: 'r1',
    at,
    target: { name: 'local', evidence: 'upload' },
    pin: { kind: 'local' },
    evidence: [],
    ...overrides,
  });

  const buildFile = (path: string, overrides: Partial<JourneyFile> = {}): JourneyFile => ({
    evidence: { kind: 'screenshot', path, sha256: digest },
    bytes: 2048,
    url: null,
    refusal: null,
    ...overrides,
  });

  const buildStep = (overrides: Partial<JourneyStep> = {}): JourneyStep => ({
    command,
    ok: true,
    code: null,
    durationMs: 550,
    files: [],
    data: null,
    ...overrides,
  });

  const buildDocument = (
    steps: readonly JourneyStep[],
    options: DocumentOptions = {},
  ): ReportDocument => {
    const verdict = options.verdict ?? buildVerdict();

    return {
      registry: 'shop',
      report: {
        base: 'origin/main',
        fingerprint: 'b'.repeat(40),
        complete: true,
        features: [
          { name: verdict.feature, changed: true, status: 'verified', verdict },
          { name: 'search', changed: false, status: 'unchanged', verdict: null },
        ],
        unmapped: [...(options.unmapped ?? [])],
      },
      journeys: new Map([[verdict.feature, { steps, evidence: options.evidence ?? 'upload' }]]),
      linkHosts: options.linkHosts ?? [],
    };
  };

  const fence = '```json\n';

  const readDataBlock = (text: string): string => {
    const start = text.indexOf(fence) + fence.length;

    return text.slice(start, text.indexOf('\n```\n', start));
  };

  return {
    buildVerdict,
    buildFile,
    buildStep,
    backslash,
    readDataBlock,
    render: (steps: readonly JourneyStep[], options: DocumentOptions = {}) =>
      renderReport(buildDocument(steps, options), noCuts, secrets),
    renderDocument: (options: DocumentOptions) =>
      renderReport(buildDocument([], options), noCuts, secrets),
    renderWithUnmapped: (unmapped: readonly string[]) =>
      renderReport(buildDocument([buildStep()], { unmapped }), noCuts, secrets),
    renderWithSecretTarget: (value: string) => {
      secrets.add({ name: 'SHOP_API_TOKEN', value, origin: 'declared' });

      return renderReport(
        buildDocument([buildStep()], {
          verdict: buildVerdict({ target: { name: value, evidence: 'upload' } }),
        }),
        noCuts,
        secrets,
      );
    },
    renderWithSecret: (value: string, unmapped: readonly string[]) => {
      secrets.add({ name: 'SHOP_API_TOKEN', value, origin: 'declared' });

      return renderReport(buildDocument([buildStep()], { unmapped }), noCuts, secrets);
    },
  };
}

test('it renders the markers, the summary table, one journey section and the data comment in order', () => {
  const ctx = setupTest();
  const text = ctx.render([ctx.buildStep(), ctx.buildStep({ command: 'http get' })]);

  const lines = text
    .split('\n')
    .filter((line) => /^(?:<!--|<table>|<details>|<\/details>)/u.test(line));

  expect(lines.map((line) => line.slice(0, 12))).toStrictEqual([
    '<!-- wringer',
    '<table>',
    '<details>',
    '<table>',
    '</details>',
    '<!-- wringer',
    '<!-- /wringe',
  ]);

  expect(lines[0]).toBe('<!-- wringer:report -->');
  expect(lines[5]?.startsWith('<!-- wringer-data v2 ')).toBe(true);
  expect(lines[6]).toBe('<!-- /wringer:report -->');
});

test('it gives the summary table a row per feature with its status, target and journey', () => {
  const ctx = setupTest();

  const text = ctx.render([
    ctx.buildStep({ durationMs: 1800 }),
    ctx.buildStep({ durationMs: 2300 }),
  ]);

  expect(text).toContain(
    '<tr><td>checkout</td><td>verified</td><td>local</td><td>2 commands, 4 s</td></tr>\n<tr><td>search</td><td>unchanged</td><td>-</td><td>-</td></tr>',
  );
});

test('it shows the first 7 characters of a deployed revision beside the target', () => {
  const ctx = setupTest();

  const verdict = ctx.buildVerdict({
    target: { name: 'preview', evidence: 'upload' },
    pin: { kind: 'deployed', revision: '5e1d0a7'.padEnd(40, '0') },
  });

  expect(ctx.render([ctx.buildStep()], { verdict })).toContain('<td>preview (5e1d0a7)</td>');
});

test('it renders values holding a closing cell tag, a comment end, three backticks and the closing marker as text', () => {
  const ctx = setupTest();
  const hostile = '</td> --> ``` <!-- /wringer:report --> "x" \'y\' & z';
  const verdict = ctx.buildVerdict({ target: { name: hostile, evidence: 'upload' } });
  const step = ctx.buildStep({ command: hostile, code: hostile, ok: false });
  const text = ctx.render([step], { verdict });
  const outside = text.slice(0, text.indexOf('<!-- wringer-data'));

  expect({
    markers: outside.split('<!-- /wringer:report -->').length - 1,
    commentEnds: outside.split('-->').length - 1,
    fences: outside.split('```').length - 1,
    closers: outside.split('</td> -->').length - 1,
  }).toStrictEqual({ markers: 0, commentEnds: 1, fences: 0, closers: 0 });
});

test('it keeps only the command path in a code element, without a backtick, < or >', () => {
  const ctx = setupTest();

  expect(ctx.render([ctx.buildStep({ command: 'a`<b>' })])).toContain('<td><code>ab</code></td>');
});

test('it keeps one data comment that reads back as the report claims', () => {
  const ctx = setupTest();
  const read = parseReportComment(ctx.render([ctx.buildStep()]));

  expect(read.ok && read.comment.claims.map((claim) => claim.feature)).toStrictEqual(['checkout']);
});

test('it shows step data of an uploading journey with secrets and url credentials redacted', () => {
  const ctx = setupTest();

  const data = {
    status: 200,
    apiToken: 'planted-shop-token',
    nested: {
      Authorization: 'Bearer planted-shop-token',
      url: 'https://user:planted-pass@x.test/a',
    },
  };

  const text = ctx.render([ctx.buildStep({ data })]);

  expect(ctx.readDataBlock(text)).toBe(
    [
      '{',
      '  "status": 200,',
      '  "apiToken": "[redacted]",',
      '  "nested": {',
      '    "Authorization": "[redacted]",',
      '    "url": "https://x.test/a"',
      '  }',
      '}',
    ].join('\n'),
  );

  expect(text).toContain('<th>Data</th>');
});

test('it escapes <, > and a backtick in step data as JSON escapes so a code block stays closed', () => {
  const ctx = setupTest();
  const text = ctx.render([ctx.buildStep({ data: { html: '</td>``` -->' } })]);
  const escape = (code: string) => `${ctx.backslash}u${code}`;
  const ticks = escape('0060').repeat(3);

  expect(ctx.readDataBlock(text)).toContain(
    `"html": "${escape('003c')}/td${escape('003e')}${ticks} --${escape('003e')}"`,
  );
});

test('it cuts step data longer than 2,000 code points and says so', () => {
  const ctx = setupTest();
  const text = ctx.render([ctx.buildStep({ data: { text: '😀'.repeat(3000) } })]);
  const [kept = '', note] = ctx.readDataBlock(text).split('\n… ');

  expect({ points: kept.split(/(?:)/u).length, note }).toStrictEqual({
    points: 2000,
    note: 'cut at 2,000 characters',
  });
});

test('it hides step data of a journey whose evidence stays local and leaves out the Data column', () => {
  const ctx = setupTest();

  const text = ctx.render([ctx.buildStep({ data: { status: 200 } })], {
    evidence: 'recorded-local',
  });

  expect([text.includes('```json'), text.includes('<th>Data</th>')]).toStrictEqual([false, false]);
});

test.each([
  { title: 'null', data: null },
  { title: 'an empty object', data: {} },
  { title: 'an empty array', data: [] },
])('it shows no Data column for a step whose data is $title', (row) => {
  const ctx = setupTest();

  expect(ctx.render([ctx.buildStep({ data: row.data })])).not.toContain('<th>Data</th>');
});

test('it drops step data that is one evidence item of the step', () => {
  const ctx = setupTest();
  const file = ctx.buildFile('.wringer/runs/r1/features/cart.png');
  const step = ctx.buildStep({ files: [file], data: file.evidence });

  expect(ctx.render([step])).not.toContain('<th>Data</th>');
});

test.each([
  { cause: 'target-local', note: "<code>evidence: 'upload'</code>" },
  { cause: 'recorded-local', note: 'recorded while its target kept evidence local' },
  { cause: 'target-gone', note: 'no longer in the registry' },
  { cause: 'no-upload-flag', note: '<code>--no-upload</code>' },
  { cause: 'run-log-missing', note: 'run log is gone' },
] as const)('it notes the cause $cause once in the journey section', (row) => {
  const ctx = setupTest();
  const text = ctx.renderDocument({ evidence: row.cause });

  expect(text.split(row.note).length - 1).toBe(1);
});

test('it renders no journey table for a journey with no rows', () => {
  const ctx = setupTest();
  const text = ctx.renderDocument({ evidence: 'run-log-missing' });

  expect(text.split('<table>').length - 1).toBe(1);
});

test('it shows an uploaded raster image as an image and another file as a link named by its kind', () => {
  const ctx = setupTest();
  const image = ctx.buildFile('a/cart.png', { url: 'https://files.example/a1/cart (1).png' });
  const trace = ctx.buildFile('a/trace.zip', { url: 'https://files.example/a1/t.zip' });
  const named = { ...trace, evidence: { ...trace.evidence, kind: 'trace' } };

  const text = ctx.render([ctx.buildStep({ files: [image, named] })], {
    linkHosts: ['files.example'],
  });

  expect(text).toContain(
    '<td><img src="https://files.example/a1/cart%20%281%29.png" width="320" /><br><a href="https://files.example/a1/t.zip">trace</a></td>',
  );
});

test('it shows a link to another host or over http as a local file', () => {
  const ctx = setupTest();
  const other = ctx.buildFile('a/one.png', { url: 'https://evil.example/one.png' });
  const plain = ctx.buildFile('a/two.png', { url: 'http://files.example/two.png' });

  const text = ctx.render([ctx.buildStep({ files: [other, plain] })], {
    linkHosts: ['files.example'],
  });

  expect(text).toContain('<td>one.png (2.0 KB)<br>two.png (2.0 KB)</td>');
});

test('it shows a local file by its name and size, or as missing', () => {
  const ctx = setupTest();
  const small = ctx.buildFile('a/b/cart.png', { bytes: 12 });
  const gone = ctx.buildFile('a/gone.png', { bytes: null });

  expect(ctx.render([ctx.buildStep({ files: [small, gone] })])).toContain(
    '<td>cart.png (12 B)<br>gone.png (missing)</td>',
  );
});

test('it names the changed paths that no feature maps', () => {
  const ctx = setupTest();

  expect(ctx.renderWithUnmapped(['scripts/<seed>.ts'])).toContain(
    '<p>Changed paths that no feature maps: <code>scripts/seed.ts</code>.</p>',
  );
});

test('it scrubs a secret that holds an ampersand from a path before it escapes the path', () => {
  const ctx = setupTest();
  const text = ctx.renderWithSecret('planted&shop-token', ['scripts/planted&shop-token.ts']);

  expect(text).toContain('<code>scripts/[redacted:SHOP_API_TOKEN].ts</code>');
});

test('it scrubs a secret that holds an angle bracket from the data comment', () => {
  const ctx = setupTest();
  const text = ctx.renderWithSecretTarget('planted<shop-token');

  expect(text).not.toContain('planted');
  expect(text).not.toContain(String.raw`planted\u003cshop-token`);
  expect(text).toContain('[redacted:SHOP_API_TOKEN]');
});

test('it leaves out the unmapped line when every path maps', () => {
  const ctx = setupTest();

  expect(ctx.renderWithUnmapped([])).not.toContain('no feature maps');
});

test('it gives the same text for the same document', () => {
  const ctx = setupTest();
  const step = ctx.buildStep({ data: { count: 1 } });

  expect(ctx.render([step])).toBe(ctx.render([step]));
});
