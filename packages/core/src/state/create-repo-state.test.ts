import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createRepoState } from './create-repo-state.ts';

function setupTest() {
  const root = createTempDir('repo-state').path;

  return { root, state: createRepoState(root, '.wringer') };
}

test('it keeps the state under the repo state folder', async () => {
  const ctx = setupTest();

  await ctx.state.writePointers((current) => ({ ...current, feature: 'checkout' }));

  const pointers = await ctx.state.readPointers();

  expect({ statePath: ctx.state.paths.state, feature: pointers.feature }).toStrictEqual({
    statePath: join(ctx.root, '.wringer', 'state.json'),
    feature: 'checkout',
  });
});
