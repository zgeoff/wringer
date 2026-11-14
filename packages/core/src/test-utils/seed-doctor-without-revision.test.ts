import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createRepoState } from '../state/create-repo-state.ts';
import { createTestFolder } from './create-test-folder.ts';
import { seedDoctorWithoutRevision } from './seed-doctor-without-revision.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'seed-doctor-without-revision');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return { state: createRepoState(root, '.wringer') };
}

test('it appends a passed doctor with no results to the run', async () => {
  const ctx = await setupTest();

  await ctx.state.appendEvent('pantry-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f1',
  });

  await seedDoctorWithoutRevision(ctx.state);

  const events = await ctx.state.readRunEvents('pantry-run');

  expect(events).toStrictEqual([
    expect.objectContaining({ type: 'run-started' }),
    { type: 'doctor-passed', at: expect.any(String), results: [] },
  ]);
});
