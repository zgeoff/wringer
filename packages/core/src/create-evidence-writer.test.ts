import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEvidenceWriter } from './create-evidence-writer.ts';
import { createNodeRepoHost } from './create-node-repo-host.ts';
import { createSecretSet } from './create-secret-set.ts';
import type { Evidence } from './envelope.ts';
import { buildStubClock } from './test-utils/build-stub-clock.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'evidence-writer');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const clock = buildStubClock();
  const secrets = createSecretSet();

  secrets.add({ name: 'SHOP_API_TOKEN', value: 'planted-shop-token', origin: 'declared' });

  const evidence = createEvidenceWriter({
    root,
    directory: join(root, '.wringer', 'evidence'),
    now: clock.now,
    files: createNodeRepoHost(),
    secrets,
  });

  return {
    root,
    clock,
    evidence,
    readText: (path: string) => readFile(join(root, path), 'utf8'),
    seedFolder: () => mkdir(join(root, '.wringer', 'evidence'), { recursive: true }),
  };
}

test('it writes a file under a stamped name, relative to the root', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const evidence = await ctx.evidence.writer.writeFile('http', 'get.json', '{"ok":true}');

  expect(evidence).toStrictEqual({
    kind: 'http',
    path: '.wringer/evidence/2026-03-01T09-30-00-000Z-get.json',
    sha256: new Bun.CryptoHasher('sha256').update('{"ok":true}').digest('hex'),
    scrub: 'text',
  });
});

test.each([
  { name: 'note.txt', scrub: 'text' },
  { name: 'snapshot.yaml', scrub: 'text' },
  { name: 'session.har', scrub: 'opaque' },
])('it scrubs a string named $name and records it as $scrub', async (row) => {
  const ctx = await setupTest();

  const evidence = await ctx.evidence.writer.writeFile(
    'note',
    row.name,
    `token planted-shop-token end`,
  );

  expect({ scrub: evidence.scrub, text: await ctx.readText(evidence.path) }).toStrictEqual({
    scrub: row.scrub,
    text: 'token [redacted:SHOP_API_TOKEN] end',
  });
});

test.each(['data.json', 'data.yaml', 'data.txt', 'data.log', 'data.md'])(
  'it scrubs bytes named %s and records them as text',
  async (name) => {
    const ctx = await setupTest();

    const evidence = await ctx.evidence.writer.writeFile(
      'note',
      name,
      Buffer.from(`token planted-shop-token`),
    );

    expect({ scrub: evidence.scrub, text: await ctx.readText(evidence.path) }).toStrictEqual({
      scrub: 'text',
      text: 'token [redacted:SHOP_API_TOKEN]',
    });
  },
);

test('it keeps bytes under another name unscrubbed and records them as opaque', async () => {
  const ctx = await setupTest();

  const evidence = await ctx.evidence.writer.writeFile(
    'screenshot',
    'page.png',
    Buffer.from(`png planted-shop-token`),
  );

  expect({ scrub: evidence.scrub, text: await ctx.readText(evidence.path) }).toStrictEqual({
    scrub: 'opaque',
    text: `png planted-shop-token`,
  });
});

test('it records the sha256 of the scrubbed bytes', async () => {
  const ctx = await setupTest();

  const evidence = await ctx.evidence.writer.writeFile(
    'note',
    'note.txt',
    `a planted-shop-token b`,
  );

  expect(evidence.sha256).toBe(
    new Bun.CryptoHasher('sha256').update('a [redacted:SHOP_API_TOKEN] b').digest('hex'),
  );
});

test.each(['page.png', 'clip.webm', 'photo.JPG'])(
  'it refuses a string named %s with an internal error',
  async (name) => {
    const ctx = await setupTest();

    expect(ctx.evidence.writer.writeFile('screenshot', name, 'not an image')).rejects.toMatchObject(
      { code: 'internal' },
    );
  },
);

test('it refuses bytes that are not valid UTF-8 under a text name', async () => {
  const ctx = await setupTest();

  expect(
    ctx.evidence.writer.writeFile('note', 'data.json', Uint8Array.of(0xff, 0xfe, 0x00)),
  ).rejects.toMatchObject({ code: 'internal' });
});

test('it records a file that already exists as opaque and adds it to the collected list', async () => {
  const ctx = await setupTest();

  await ctx.seedFolder();

  await writeFile(join(ctx.root, '.wringer', 'evidence', 'receipt.png'), 'receipt bytes');

  const evidence = await ctx.evidence.writer.addFile(
    'screenshot',
    join(ctx.root, '.wringer', 'evidence', 'receipt.png'),
  );

  const expected = {
    kind: 'screenshot',
    path: '.wringer/evidence/receipt.png',
    sha256: new Bun.CryptoHasher('sha256').update('receipt bytes').digest('hex'),
    scrub: 'opaque',
  } satisfies Evidence;

  expect({ evidence, collected: ctx.evidence.collected }).toStrictEqual({
    evidence: expected,
    collected: [expected],
  });
});

test('it refuses to add a symlink', async () => {
  const ctx = await setupTest();

  await ctx.seedFolder();

  await writeFile(join(ctx.root, 'outside.txt'), 'outside');
  await symlink(join(ctx.root, 'outside.txt'), join(ctx.root, '.wringer', 'evidence', 'link.png'));

  expect(
    ctx.evidence.writer.addFile('screenshot', join(ctx.root, '.wringer', 'evidence', 'link.png')),
  ).rejects.toMatchObject({ code: 'internal' });
});

test('it refuses to add a file outside its folder', async () => {
  const ctx = await setupTest();

  await ctx.seedFolder();

  await writeFile(join(ctx.root, 'receipt.png'), 'receipt bytes');

  expect(
    ctx.evidence.writer.addFile('screenshot', join(ctx.root, 'receipt.png')),
  ).rejects.toMatchObject({ code: 'internal' });
});

test('it refuses to add a file that does not exist', async () => {
  const ctx = await setupTest();

  await ctx.seedFolder();

  expect(
    ctx.evidence.writer.addFile('screenshot', join(ctx.root, '.wringer', 'evidence', 'gone.png')),
  ).rejects.toMatchObject({ code: 'internal' });
});

test('it keeps both files when two writes in one millisecond share a name', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const written = await Promise.all([
    ctx.evidence.writer.writeFile('http', 'get.json', 'first'),
    ctx.evidence.writer.writeFile('http', 'get.json', 'second'),
  ]);

  const contents = await Promise.all(written.map((evidence) => ctx.readText(evidence.path)));

  expect(contents.toSorted()).toStrictEqual(['first', 'second']);
});
