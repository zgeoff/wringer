import { expect, onTestFinished, test } from 'bun:test';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from './create-test-folder.ts';
import { seedEvidenceFolder } from './seed-evidence-folder.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'seed-evidence-folder');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    probeFolder: async (path: string) => {
      const info = await stat(join(root, path));

      return info.isDirectory();
    },
  };
}

test('it creates the evidence folder under the state folder of the root', async () => {
  const ctx = await setupTest();

  await seedEvidenceFolder(ctx.root);

  const isFolder = await ctx.probeFolder('.wringer/evidence');

  expect(isFolder).toBeTrue();
});

test('it leaves an evidence folder that already exists in place', async () => {
  const ctx = await setupTest();

  await seedEvidenceFolder(ctx.root);
  await seedEvidenceFolder(ctx.root);

  const isFolder = await ctx.probeFolder('.wringer/evidence');

  expect(isFolder).toBeTrue();
});
