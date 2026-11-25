import { expect, test } from 'bun:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { seedEvidenceFolder } from './seed-evidence-folder.ts';

function setupTest() {
  const root = createTempDir('seed-evidence-folder').path;

  return {
    root,
    probeFolder: async (path: string) => {
      const info = await stat(join(root, path));

      return info.isDirectory();
    },
  };
}

test('it creates the evidence folder under the state folder of the root', async () => {
  const ctx = setupTest();

  await seedEvidenceFolder(ctx.root);

  const isFolder = await ctx.probeFolder('.wringer/evidence');

  expect(isFolder).toBeTrue();
});

test('it leaves an evidence folder that already exists in place', async () => {
  const ctx = setupTest();

  await seedEvidenceFolder(ctx.root);
  await seedEvidenceFolder(ctx.root);

  const isFolder = await ctx.probeFolder('.wringer/evidence');

  expect(isFolder).toBeTrue();
});
