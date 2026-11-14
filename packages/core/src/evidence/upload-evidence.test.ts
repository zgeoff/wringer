import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Evidence } from '../envelope/envelope.ts';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { createRepoState } from '../state/create-repo-state.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { createFileHostStandIn } from '../test-utils/create-file-host-stand-in.ts';
import type { FileHostStandInOptions } from '../test-utils/create-file-host-stand-in.ts';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { seedEvidenceFile } from '../test-utils/seed-evidence-file.ts';
import { createHostUploader } from './create-host-uploader.ts';
import { uploadEvidence } from './upload-evidence.ts';
import type { UploadItem } from './upload-evidence.ts';

async function setupTest(hostOptions: Partial<FileHostStandInOptions> = {}) {
  const token = 'planted-upload-token';

  const root = await createTestFolder(import.meta.dir, 'upload-evidence');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const features = join(root, '.wringer', 'runs', 'r-7c1', 'features', 'place-order');

  await mkdir(features, { recursive: true });

  const host = createFileHostStandIn({ token, ...hostOptions });
  const clock = buildStubClock();
  const state = createRepoState(root, '.wringer');
  const secrets = createSecretSet();

  clock.set('2026-11-13T00:00:00.000Z');

  const createServices = (env: Record<string, string | undefined>) => ({
    uploader: createHostUploader({ urlEnv: 'URL', tokenEnv: 'FILE_ACCESS' }, { env, fetch }),
    state,
    files: createNodeRepoHost(),
    root,
    stateDir: join(root, '.wringer'),
    secrets,
    now: clock.now,
    signal: AbortSignal.timeout(10_000),
  });

  return {
    root,
    token,
    buildItem: (evidence: Evidence, targetUploads = true): UploadItem => ({
      evidence,
      targetUploads,
      label: 'shop/place-order',
    }),
    host,
    clock,
    secrets,
    readRecord: () => state.readUploads(),
    seed: {
      evidenceFile: (name: string, content: string, scrub?: 'text' | 'opaque') =>
        seedEvidenceFile(root, name, content, scrub),
    },
    upload: (items: readonly UploadItem[], env?: Record<string, string | undefined>) =>
      uploadEvidence(items, createServices(env ?? { URL: host.url, FILE_ACCESS: token })),
  };
}

test('it sends a clean file with its label and content type, and returns the link', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');
  const outcomes = await ctx.upload([ctx.buildItem(evidence)]);

  expect({ outcomes, uploads: ctx.host.uploads }).toStrictEqual({
    outcomes: [
      {
        kind: 'linked',
        isReused: false,
        link: {
          url: `https://${ctx.host.host}/files/receipt.txt`,
          expiresAt: '2026-12-13T00:00:00.000Z',
        },
      },
    ],
    uploads: [
      {
        method: 'POST',
        authorization: `Bearer ${ctx.token}`,
        filename: 'receipt.txt',
        contentType: 'text/plain',
        text: 'paid 12',
        label: 'shop/place-order',
        expires: '30d',
      },
    ],
  });
});

test('it records each link in the reuse record, keyed by host, hash and extension', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await ctx.upload([ctx.buildItem(evidence)]);

  const record = await ctx.readRecord();

  expect(record).toStrictEqual({
    [`${ctx.host.host} ${evidence.sha256}.txt`]: {
      url: `https://${ctx.host.host}/files/receipt.txt`,
      expiresAt: '2026-12-13T00:00:00.000Z',
      uploadedAt: '2026-11-13T00:00:00.000Z',
    },
  });
});

test('it reuses a link with 7 days left and sends nothing', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await ctx.upload([ctx.buildItem(evidence)]);

  ctx.clock.set('2026-12-06T00:00:00.000Z');

  const outcomes = await ctx.upload([ctx.buildItem(evidence)]);

  expect({
    reused: outcomes.map((outcome) => outcome.kind === 'linked' && outcome.isReused),
    sent: ctx.host.uploads.length,
  }).toStrictEqual({
    reused: [true],
    sent: 1,
  });
});

test('it uploads a file again when its link has less than 7 days left', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await ctx.upload([ctx.buildItem(evidence)]);

  ctx.clock.set('2026-12-06T00:00:01.000Z');

  await ctx.upload([ctx.buildItem(evidence)]);

  expect(ctx.host.uploads.length).toBe(2);
});

test('it sends two items with the same bytes and extension once', async () => {
  const ctx = await setupTest();
  const first = await ctx.seed.evidenceFile('a.txt', 'paid 12');
  const second = await ctx.seed.evidenceFile('b.txt', 'paid 12');
  const outcomes = await ctx.upload([ctx.buildItem(first), ctx.buildItem(second)]);

  expect({
    kinds: outcomes.map((outcome) => outcome.kind),
    sent: ctx.host.uploads.length,
  }).toStrictEqual({
    kinds: ['linked', 'linked'],
    sent: 1,
  });
});

test('it keeps an opaque file of a local target local and sends nothing', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('page.png', 'png bytes', 'opaque');
  const outcomes = await ctx.upload([ctx.buildItem(evidence, false)]);

  expect({ outcomes, sent: ctx.host.uploads.length }).toStrictEqual({
    outcomes: [
      { kind: 'local', refusal: { reason: 'opaque-on-local-target', path: evidence.path } },
    ],
    sent: 0,
  });
});

test('it sends an opaque file of an uploading target with its image type', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('page.png', 'png bytes', 'opaque');

  await ctx.upload([ctx.buildItem(evidence, true)]);

  expect(ctx.host.uploads.map((upload) => upload.contentType)).toStrictEqual(['image/png']);
});

test('it keeps a file changed after it was recorded local', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await ctx.seed.evidenceFile('receipt.txt', 'swapped after the fact');

  const outcomes = await ctx.upload([ctx.buildItem(evidence)]);

  expect({ outcomes, sent: ctx.host.uploads.length }).toStrictEqual({
    outcomes: [{ kind: 'local', refusal: { reason: 'hash-mismatch', path: evidence.path } }],
    sent: 0,
  });
});

test('it keeps a file outside the features folder local', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await writeFile(join(ctx.root, 'package.json'), '{}');

  const outcomes = await ctx.upload([ctx.buildItem({ ...evidence, path: 'package.json' })]);

  expect(outcomes).toStrictEqual([
    { kind: 'local', refusal: { reason: 'outside-features-folder', path: 'package.json' } },
  ]);
});

test('it fails with an internal error and sends no file when one holds a known secret', async () => {
  const ctx = await setupTest();
  const clean = await ctx.seed.evidenceFile('clean.txt', 'paid 12');
  const leaking = await ctx.seed.evidenceFile('leak.txt', `Bearer ${ctx.token}`);

  ctx.secrets.add({ name: 'shop.upload', value: ctx.token, origin: 'declared' });

  const error = await ctx
    .upload([ctx.buildItem(clean), ctx.buildItem(leaking)])
    .catch((error_: unknown) => error_);

  expect({ error, sent: ctx.host.uploads.length }).toStrictEqual({
    error: expect.objectContaining({ code: 'internal' }),
    sent: 0,
  });
});

test('it fails and sends no file when one holds the uploader token, whatever the variable is named', async () => {
  const ctx = await setupTest();
  const leaking = await ctx.seed.evidenceFile('leak.txt', `Bearer ${ctx.token}`);
  const error = await ctx.upload([ctx.buildItem(leaking)]).catch((error_: unknown) => error_);

  expect({ error, sent: ctx.host.uploads.length }).toStrictEqual({
    error: expect.objectContaining({ code: 'internal' }),
    sent: 0,
  });
});

test('it sends a file whose extension is the uploader token under a hash name', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile(`receipt.${ctx.token}`, 'paid 12');

  await ctx.upload([ctx.buildItem(evidence)]);

  expect(ctx.host.uploads.map((upload) => upload.filename)).toStrictEqual([
    `${evidence.sha256}.bin`,
  ]);
});

test('it fails with environment before it sends any file when the token is not set', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  const error = await ctx
    .upload([ctx.buildItem(evidence)], { URL: ctx.host.url })
    .catch((error_: unknown) => error_);

  expect({ error, sent: ctx.host.uploads.length }).toStrictEqual({
    error: expect.objectContaining({
      code: 'environment',
      message: expect.stringContaining('FILE_ACCESS'),
    }),
    sent: 0,
  });
});

test.each([
  [
    'not https',
    (filename: string, host: string) => ({ url: `http://${host}/${filename}`, expiresAt: null }),
  ],
  [
    'on another host',
    (filename: string) => ({ url: `https://other.example/${filename}`, expiresAt: null }),
  ],
  [
    'too long',
    (filename: string, host: string) => ({
      url: `https://${host}/${'a'.repeat(600)}`,
      expiresAt: null,
      filename,
    }),
  ],
])(
  'it fails with environment and records nothing when the host returns a link %s',
  async (_name, buildLink) => {
    const ctx = await setupTest({ buildLink });
    const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');
    const error = await ctx.upload([ctx.buildItem(evidence)]).catch((error_: unknown) => error_);
    const record = await ctx.readRecord();

    expect({ error, record }).toStrictEqual({
      error: expect.objectContaining({ code: 'environment' }),
      record: {},
    });
  },
);

test('it keeps the links uploaded before a failure in the reuse record', async () => {
  const ctx = await setupTest({
    buildLink: (filename, host) =>
      filename.startsWith('bad')
        ? { url: `http://${host}/${filename}`, expiresAt: null }
        : { url: `https://${host}/files/${filename}`, expiresAt: null },
  });

  const good = await ctx.seed.evidenceFile('good.txt', 'paid 12');
  const bad = await ctx.seed.evidenceFile('bad.txt', 'paid 13');

  await ctx.upload([ctx.buildItem(good), ctx.buildItem(bad)]).catch(() => null);

  const record = await ctx.readRecord();

  expect(Object.keys(record)).toStrictEqual([`${ctx.host.host} ${good.sha256}.txt`]);
});

test('it puts neither token in the error when the host refuses the token', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  const error = await ctx
    .upload([ctx.buildItem(evidence)], { URL: ctx.host.url, FILE_ACCESS: 'another-upload-token' })
    .catch((error_: unknown) => error_);

  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(/upload-token/u);
});

test('it reads a corrupt reuse record as empty and sends the file', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.seed.evidenceFile('receipt.txt', 'paid 12');

  await writeFile(join(ctx.root, '.wringer', 'uploads.json'), 'not json');

  await ctx.upload([ctx.buildItem(evidence)]);

  expect(ctx.host.uploads.length).toBe(1);
});
