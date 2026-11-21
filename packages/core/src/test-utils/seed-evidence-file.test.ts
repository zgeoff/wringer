import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { seedEvidenceFile } from './seed-evidence-file.ts';

function setupTest() {
  const root = createTempDir('seed-evidence-file').path;

  return {
    root,
    readText: (path: string) => readFile(join(root, path), 'utf8'),
  };
}

test('it returns text evidence that records the file it wrote', async () => {
  const ctx = setupTest();

  const evidence = await seedEvidenceFile(ctx.root, 'receipt.txt', 'paid 12');

  expect(evidence).toStrictEqual({
    kind: 'note',
    path: '.wringer/runs/r-7c1/features/place-order/receipt.txt',
    sha256: '57c0a1f7d08224abbfd0d0e0d7e26fad9603712d8a6b7fbdcd60cd4c6941e26a',
    scrub: 'text',
  });
});

test('it writes the content under the features folder', async () => {
  const ctx = setupTest();

  const evidence = await seedEvidenceFile(ctx.root, 'receipt.txt', 'paid 12');
  const text = await ctx.readText(evidence.path);

  expect(text).toBe('paid 12');
});

test('it records an opaque scrub when asked for one', async () => {
  const ctx = setupTest();

  const evidence = await seedEvidenceFile(ctx.root, 'page.png', 'png bytes', 'opaque');

  expect(evidence.scrub).toBe('opaque');
});
