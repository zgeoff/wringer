import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createRepoState } from './create-repo-state.ts';
import { readVerdicts } from './read-verdicts.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'read-verdicts');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const state = createRepoState(root, '.wringer');

  return { root, state, readVerdicts: () => readVerdicts(state, root) };
}

test('it reads a verdict whose data went to a payload file over the cap', async () => {
  const ctx = await setupTest();

  const verdict = {
    feature: 'checkout',
    fingerprint: 'f1',
    run: 'mf3k2a-7q1z',
    at: '2026-11-04T10:00:00.000Z',
    evidence: [],
  };

  await mkdir(join(ctx.root, '.wringer', 'payloads'), { recursive: true });
  await writeFile(join(ctx.root, '.wringer', 'payloads', 'done.json'), JSON.stringify(verdict));

  await ctx.state.appendEvent('mf3k2a-7q1z', {
    type: 'run-started',
    at: '2026-11-04T09:59:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f1',
  });

  await ctx.state.appendEvent('mf3k2a-7q1z', {
    type: 'envelope',
    at: '2026-11-04T10:00:00.000Z',
    drive: false,
    envelope: {
      wringer: 1,
      ok: true,
      command: 'done',
      target: 'local',
      instance: 'mf3k2a-7q1z',
      feature: 'checkout',
      sha: null,
      durationMs: 12,
      data: null,
      evidence: [],
      cursors: {},
      truncated: true,
      truncatedPath: '.wringer/payloads/done.json',
      error: null,
    },
  });

  const verdicts = await ctx.readVerdicts();

  expect(verdicts.get('checkout')).toStrictEqual(verdict);
});
