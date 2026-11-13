import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeRepoHost } from './create-node-repo-host.ts';
import { readUploadCandidate } from './read-upload-candidate.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'upload-candidate');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const features = join(root, '.wringer', 'runs', 'r-7c1', 'features', 'place-order');

  await mkdir(features, { recursive: true });

  return {
    root,
    features,
    read: (path: string, recordedContent: string, scrub?: 'text' | 'opaque') =>
      readUploadCandidate(
        {
          kind: 'note',
          path,
          sha256: new Bun.CryptoHasher('sha256').update(recordedContent).digest('hex'),
          scrub,
        },
        { root, stateDir: join(root, '.wringer'), files: createNodeRepoHost() },
      ),
  };
}

test('it reads the hash and text of a file in the features folder', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.features, 'note.txt'), 'paid 12');

  const candidate = await ctx.read(
    '.wringer/runs/r-7c1/features/place-order/note.txt',
    'paid 12',
    'text',
  );

  const sha256 = new Bun.CryptoHasher('sha256').update('paid 12').digest('hex');

  expect(candidate).toStrictEqual({
    evidence: {
      kind: 'note',
      path: '.wringer/runs/r-7c1/features/place-order/note.txt',
      sha256,
      scrub: 'text',
    },
    exists: true,
    realPath: expect.stringMatching(/features\/place-order\/note\.txt$/u),
    isInFeaturesFolder: true,
    isRegularFile: true,
    sha256,
    text: 'paid 12',
  });
});

test('it reads no text of an opaque file', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.features, 'note.txt'), 'paid 12');

  const candidate = await ctx.read(
    '.wringer/runs/r-7c1/features/place-order/note.txt',
    'paid 12',
    'opaque',
  );

  expect(candidate.text).toBeNull();
});

test('it reads a file changed after it was recorded as a different hash', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.features, 'note.txt'), 'changed since');

  const candidate = await ctx.read(
    '.wringer/runs/r-7c1/features/place-order/note.txt',
    'paid 12',
    'text',
  );

  expect(candidate.sha256).toBe(
    new Bun.CryptoHasher('sha256').update('changed since').digest('hex'),
  );
});

test('it reads a missing file as one that does not exist', async () => {
  const ctx = await setupTest();

  const candidate = await ctx.read(
    '.wringer/runs/r-7c1/features/place-order/note.txt',
    'paid 12',
    'text',
  );

  expect({ exists: candidate.exists, sha256: candidate.sha256 }).toStrictEqual({
    exists: false,
    sha256: null,
  });
});

test('it reads a symlink as a file that is not regular, and reads none of its target', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'outside.txt'), 'outside');
  await symlink(join(ctx.root, 'outside.txt'), join(ctx.features, 'note.txt'));

  const candidate = await ctx.read(
    '.wringer/runs/r-7c1/features/place-order/note.txt',
    'outside',
    'text',
  );

  expect({
    isRegularFile: candidate.isRegularFile,
    isInFeaturesFolder: candidate.isInFeaturesFolder,
    text: candidate.text,
  }).toStrictEqual({ isRegularFile: false, isInFeaturesFolder: false, text: null });
});

test.each(['.wringer/runs/r-7c1/manifest.json', '.wringer/runs/r-7c1/children/app.log'])(
  'it places %s outside the features folder',
  async (path) => {
    const ctx = await setupTest();

    await mkdir(join(ctx.root, '.wringer', 'runs', 'r-7c1', 'children'), { recursive: true });
    await writeFile(join(ctx.root, path), 'x');

    const candidate = await ctx.read(path, 'x', 'text');

    expect({
      isInFeaturesFolder: candidate.isInFeaturesFolder,
      sha256: candidate.sha256,
    }).toStrictEqual({ isInFeaturesFolder: false, sha256: null });
  },
);
