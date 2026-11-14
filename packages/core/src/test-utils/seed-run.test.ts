import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createRepoState } from '../state/create-repo-state.ts';
import { createTestFolder } from './create-test-folder.ts';
import { seedRun } from './seed-run.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'seed-run');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return { state: createRepoState(root, '.wringer') };
}

test('it starts the run with an attach to the box target', async () => {
  const ctx = await setupTest();

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
