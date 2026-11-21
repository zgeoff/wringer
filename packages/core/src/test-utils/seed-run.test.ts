import { expect, test } from 'bun:test';
import { createTempDir } from '@zgeoff/testing/fs';
import { createRepoState } from '../state/create-repo-state.ts';
import { seedRun } from './seed-run.ts';

function setupTest() {
  const root = createTempDir('seed-run').path;

  return { state: createRepoState(root, '.wringer') };
}

test('it starts the run with an attach to the box target', async () => {
  const ctx = setupTest();

  await seedRun(ctx.state, 'pantry-run');

  const events = await ctx.state.readRunEvents('pantry-run');

  expect(events).toStrictEqual([
    {
      type: 'run-started',
      at: '2026-11-04T10:00:00.000Z',
      target: 'box',
      mode: 'attach',
      fingerprint: 'empty',
    },
  ]);
});
