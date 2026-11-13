import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { collectShownFiles } from './collect-shown-files.ts';
import { createSecretSet } from './create-secret-set.ts';
import { planReport } from './plan-report.ts';
import { renderReport } from './render-report.ts';
import type { JourneyFile, JourneyStep, ReportDocument } from './report-document.ts';
import { noCuts } from './report-plan.ts';
import type { ReportPlan } from './report-plan.ts';
import type { Verdict } from './report-schema.ts';

interface FeatureSpec {
  readonly name: string;
  readonly steps: readonly StepSpec[];
  readonly evidence?: 'upload' | 'target-local';
}

interface StepSpec {
  readonly files?: readonly string[];
  readonly data?: unknown;
}

function setupTest() {
  const secrets = createSecretSet();
  const digest = 'c'.repeat(64);
  const host = 'files.example';
  const filler = 'x';

  const buildVerdict = (feature: string): Verdict => ({
    feature,
    fingerprint: digest.slice(0, 40),
    featureFingerprint: digest.slice(0, 40),
    run: 'r1',
    at: '2026-11-04T10:00:00.000Z',
    target: { name: 'local', evidence: 'upload' },
    pin: { kind: 'local' },
    evidence: [],
  });

  // Every file has a path of its own, so a test can tell the files apart.
  const buildDocument = (features: readonly FeatureSpec[]): ReportDocument => {
    let counter = 0;

    const buildStep = (spec: StepSpec): JourneyStep => ({
      command: 'browser screenshot',
      ok: true,
      code: null,
      durationMs: 120,
      files: (spec.files ?? []).map((extension): JourneyFile => ({
        evidence: {
          kind: 'screenshot',
          path: `out/f${(counter += 1)}.${extension}`,
          sha256: digest,
        },
        bytes: 2048,
        url: null,
      })),
      data: spec.data ?? null,
    });

    return {
      registry: 'shop',
      report: {
        base: 'origin/main',
        fingerprint: 'b'.repeat(40),
        complete: true,
        features: features.map((feature) => ({
          name: feature.name,
          changed: true,
          status: 'verified',
          verdict: buildVerdict(feature.name),
        })),
        unmapped: [],
      },
      journeys: new Map(
        features.map((feature) => [
          feature.name,
          { steps: feature.steps.map(buildStep), evidence: feature.evidence ?? 'upload' },
        ]),
      ),
      linkHosts: [host],
    };
  };

  // What the uploader's links look like once publish builds the document: each `linkChars` long.
  const withLinks = (document: ReportDocument, linkChars: number): ReportDocument => {
    const prefix = `https://${host}/`;
    const url = prefix + 'b'.repeat(linkChars - prefix.length);

    return {
      ...document,
      journeys: new Map(
        [...document.journeys].map(([name, journey]) => [
          name,
          {
            ...journey,
            steps: journey.steps.map((step) => ({
              ...step,
              files: step.files.map((file) =>
                journey.evidence === 'upload' ? { ...file, url } : file,
              ),
            })),
          },
        ]),
      ),
    };
  };

  const dataOf = (size: number) => ({ note: filler.repeat(size) });
  const dataArbitrary = fc.record({ note: fc.string({ maxLength: 400 }) });

  const stepArbitrary = fc.record({
    files: fc.array(fc.constantFrom('png', 'jpg', 'webm', 'json'), { maxLength: 6 }),
    data: fc.option(dataArbitrary, { nil: undefined }),
  });

  const featuresArbitrary = fc
    .array(
      fc.record({
        steps: fc.array(stepArbitrary, { maxLength: 30 }),
        evidence: fc.constantFrom('upload' as const, 'upload' as const, 'target-local' as const),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .map((features): readonly FeatureSpec[] =>
      features.map((feature, index) => ({ ...feature, name: `feature-${index}` })),
    );

  return {
    dataOf,
    secrets,
    featuresArbitrary,
    buildDocument,
    withLinks,
    plan: (document: ReportDocument, budgetChars: number, linkChars = 80) =>
      planReport(document, { budgetChars, linkChars }, secrets),
    render: (document: ReportDocument, plan: ReportPlan) => renderReport(document, plan, secrets),
    uncutChars: (document: ReportDocument) => renderReport(document, noCuts, secrets).length,
  };
}

test('it takes no cut when the uncut report fits', () => {
  const ctx = setupTest();
  const document = ctx.buildDocument([{ name: 'checkout', steps: [{ data: ctx.dataOf(50) }] }]);
  const result = ctx.plan(document, ctx.uncutChars(document));

  expect(result).toStrictEqual({
    ok: true,
    plan: {
      cuts: { droppedData: 0, collapsed: 0, shortCells: 0, omitted: 0 },
      features: new Map(),
    },
    chars: ctx.uncutChars(document),
  });
});

test('it drops the largest step data first, and the later step on a tie', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    {
      name: 'checkout',
      steps: [{ data: ctx.dataOf(300) }, { data: ctx.dataOf(100) }, { data: ctx.dataOf(300) }],
    },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document) - 1);

  expect(result.ok && [...(result.plan.features.get('checkout')?.droppedData ?? [])]).toStrictEqual(
    [2],
  );
});

test('it drops step data before it collapses a table', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    {
      name: 'checkout',
      steps: Array.from({ length: 14 }, (_unused, index) => ({ data: ctx.dataOf(100 + index) })),
    },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document) - 200);

  expect(result.ok && result.plan.cuts).toStrictEqual({
    droppedData: expect.toBeWithin(1, 14),
    collapsed: 0,
    shortCells: 0,
    omitted: 0,
  });
});

test('it collapses a table of 12 rows to its first and last 5 rows once the data is gone', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    { name: 'checkout', steps: Array.from({ length: 12 }, () => ({})) },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document) - 1);

  expect(result.ok && result.plan.features.get('checkout')).toStrictEqual({
    omitted: false,
    collapsed: true,
    droppedData: new Set(),
    shortCells: new Set(),
  });
});

test('it leaves a table of 11 rows whole', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    { name: 'checkout', steps: Array.from({ length: 11 }, () => ({})) },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document) - 1);

  expect(result.ok && result.plan.cuts.collapsed).toBe(0);
});

test('it cuts a cell of 4 files to 3 and keeps the images', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    { name: 'checkout', steps: [{ files: ['json', 'png', 'webm', 'jpg'] }] },
  ]);

  const linked = ctx.withLinks(document, 80);
  const result = ctx.plan(document, ctx.uncutChars(linked) - 1);

  expect(result.ok).toBe(true);

  const plan = result.ok ? result.plan : noCuts;
  const text = ctx.render(linked, plan);

  expect(text).toContain('+1 more');

  expect(collectShownFiles(document, plan, 80).map((file) => file.evidence.path)).toStrictEqual([
    'out/f1.json',
    'out/f2.png',
    'out/f4.jpg',
  ]);
});

test('it replaces a journey section with one line when every other cut is taken', () => {
  const ctx = setupTest();
  const document = ctx.buildDocument([{ name: 'checkout', steps: [{}, {}, {}] }]);
  const plain = ctx.plan(document, 0);
  const minimum = plain.ok ? 0 : plain.minimumChars;
  const result = ctx.plan(document, minimum);

  expect(result.ok && result.plan.cuts).toStrictEqual({
    droppedData: 0,
    collapsed: 0,
    shortCells: 0,
    omitted: 1,
  });

  expect(result.ok && ctx.render(document, result.plan)).toContain(
    '<p>checkout: 3 commands, 360 ms. The journey is left out to fit the PR description.</p>',
  );
});

test('it fails with the smallest size it can reach when the report cannot fit', () => {
  const ctx = setupTest();
  const document = ctx.buildDocument([{ name: 'checkout', steps: [{}, {}] }]);
  const result = ctx.plan(document, 100);

  expect(result).toStrictEqual({ ok: false, minimumChars: expect.toBeWithin(101, 100_000) });
});

test('it keeps an empty journey whole when its one-line omission is longer', () => {
  const ctx = setupTest();
  const document = ctx.buildDocument([{ name: 'checkout', steps: [] }]);
  const result = ctx.plan(document, ctx.uncutChars(document) - 1);

  expect(result).toStrictEqual({ ok: false, minimumChars: ctx.uncutChars(document) });
});

test('it never reports a smallest size above the uncut size', () => {
  const ctx = setupTest();

  fc.assert(
    fc.property(
      ctx.featuresArbitrary,
      fc.double({ min: 0, max: 1, noNaN: true }),
      (specs, share) => {
        const document = ctx.withLinks(ctx.buildDocument(specs), 80);
        const uncut = ctx.uncutChars(document);
        const result = ctx.plan(document, Math.floor(uncut * share));

        return result.ok || result.minimumChars <= uncut;
      },
    ),
  );
});

test('it sizes a local journey and a missing file as local cells', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    { name: 'checkout', evidence: 'target-local', steps: [{ files: ['png'] }] },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document), 500);

  expect(result.ok && result.chars).toBe(ctx.uncutChars(document));
  expect(result.ok && collectShownFiles(document, result.plan, 500)).toStrictEqual([]);
});

test('it fits a report of 4 features and 210 evidence files', () => {
  const ctx = setupTest();

  const feature = (name: string, extra: number) => ({
    name,
    steps: [
      ...Array.from({ length: 5 }, () => ({
        files: Array.from({ length: 10 }, () => 'png'),
        data: ctx.dataOf(1500),
      })),
      { files: Array.from({ length: 2 + extra }, () => 'webm'), data: ctx.dataOf(1500) },
    ],
  });

  const document = ctx.withLinks(
    ctx.buildDocument([feature('a', 2), feature('b', 0), feature('c', 0), feature('d', 0)]),
    512,
  );

  const result = ctx.plan(document, 61_200, 512);
  const rendered = result.ok ? ctx.render(document, result.plan) : '';

  const files = [...document.journeys.values()].flatMap((journey) =>
    journey.steps.flatMap((step) => step.files),
  );

  expect(files).toHaveLength(210);
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.length).toBeLessThanOrEqual(61_200);
  expect(result.ok && result.chars).toBe(rendered.length);
});

test('it renders the planned length when every link has the planned length', () => {
  const ctx = setupTest();

  fc.assert(
    fc.property(
      ctx.featuresArbitrary,
      fc.integer({ min: 40, max: 160 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      (specs, linkChars, share) => {
        const document = ctx.withLinks(ctx.buildDocument(specs), linkChars);
        const budgetChars = Math.floor(ctx.uncutChars(document) * share);
        const result = ctx.plan(document, budgetChars, linkChars);

        return result.ok
          ? ctx.render(document, result.plan).length === result.chars && result.chars <= budgetChars
          : result.minimumChars > budgetChars;
      },
    ),
  );
});

test('it never shows with a smaller budget a file that a larger budget hid', () => {
  const ctx = setupTest();

  fc.assert(
    fc.property(
      ctx.featuresArbitrary,
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      (specs, shareA, shareB) => {
        const document = ctx.withLinks(ctx.buildDocument(specs), 80);
        const uncut = ctx.uncutChars(document);
        const small = ctx.plan(document, Math.floor(uncut * Math.min(shareA, shareB)));
        const large = ctx.plan(document, Math.floor(uncut * Math.max(shareA, shareB)));

        if (!small.ok || !large.ok) {
          return true;
        }

        const shownLarge = new Set(
          collectShownFiles(document, large.plan, 80).map((file) => file.evidence.path),
        );

        return collectShownFiles(document, small.plan, 80).every((file) =>
          shownLarge.has(file.evidence.path),
        );
      },
    ),
  );
});

test('it renders a collapsed table as the first 5 rows, a gap row and the last 5 rows', () => {
  const ctx = setupTest();

  const document = ctx.buildDocument([
    { name: 'checkout', steps: Array.from({ length: 12 }, () => ({})) },
  ]);

  const result = ctx.plan(document, ctx.uncutChars(document) - 1);
  const text = result.ok ? ctx.render(document, result.plan) : '';

  expect(
    text.match(/<tr><td>(?<row>\d+)<\/td>|<tr><td colspan="4">2 more steps not shown/gu),
  ).toHaveLength(11);

  expect(text).toContain('<td>5</td>');
  expect(text).not.toContain('<td>6</td>');
  expect(text).toContain('<td>8</td>');
});

test('it sizes a link at its full length when a secret matches the filler of a stand-in link', () => {
  const ctx = setupTest();

  ctx.secrets.add({ name: 'FILLER', value: 'aaaaaaaa', origin: 'declared' });

  const document = ctx.withLinks(
    ctx.buildDocument([{ name: 'checkout', steps: [{ files: ['png', 'webm'] }] }]),
    512,
  );

  const result = ctx.plan(document, ctx.uncutChars(document), 512);

  expect(result.ok && result.chars).toBe(ctx.uncutChars(document));
});

test('it collapses the longer table first, whatever its row count', () => {
  const ctx = setupTest();

  const document = ctx.withLinks(
    ctx.buildDocument([
      { name: 'images', steps: Array.from({ length: 12 }, () => ({ files: ['png'] })) },
      { name: 'empty', steps: Array.from({ length: 13 }, () => ({})) },
    ]),
    80,
  );

  const result = ctx.plan(document, ctx.uncutChars(document) - 1, 80);

  expect(result.ok && result.plan.features).toStrictEqual(
    new Map([
      [
        'images',
        { omitted: false, collapsed: true, droppedData: new Set(), shortCells: new Set() },
      ],
    ]),
  );
});
