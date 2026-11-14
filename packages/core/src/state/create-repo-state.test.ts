import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { createRepoState } from './create-repo-state.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'repo-state');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return { root, state: createRepoState(root, '.wringer') };
}

test('it keeps the state under the repo state folder', async () => {
  const ctx = await setupTest();

  await ctx.state.writePointers((current) => ({ ...current, feature: 'checkout' }));

  const pointers = await ctx.state.readPointers();

  expect({ statePath: ctx.state.paths.state, feature: pointers.feature }).toStrictEqual({
    statePath: join(ctx.root, '.wringer', 'state.json'),
    feature: 'checkout',
  });
});
