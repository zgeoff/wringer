import { expect, test } from 'bun:test';
import { createTempDir } from '@zgeoff/testing/fs';
import { createRepoState } from '../state/create-repo-state.ts';
import { seedDoctorWithoutRevision } from './seed-doctor-without-revision.ts';

function setupTest() {
  const root = createTempDir('seed-doctor-without-revision').path;

  return { state: createRepoState(root, '.wringer') };
}

test('it appends a passed doctor with no results to the run', async () => {
  const ctx = setupTest();

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
