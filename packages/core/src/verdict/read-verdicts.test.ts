import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createRepoState } from '../state/create-repo-state.ts';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { seedOverCapDone } from '../test-utils/seed-over-cap-done.ts';
import { readVerdicts } from './read-verdicts.ts';
import type { Verdict } from './report-schema.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'read-verdicts');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const state = createRepoState(root, '.wringer');

  return {
    state,
    readVerdicts: () => readVerdicts(state, createNodeRepoHost(), root),
    seed: { overCapDone: (verdict: unknown) => seedOverCapDone(root, state, verdict) },
  };
}

test('it reads a verdict whose data went to a payload file over the cap', async () => {
  const ctx = await setupTest();

  const verdict: Verdict = {
    feature: 'checkout',
    fingerprint: 'b'.repeat(40),
    featureFingerprint: 'a'.repeat(40),
    run: 'mf3k2a-7q1z',
    at: '2026-11-04T10:00:00.000Z',
    target: { name: 'local', evidence: 'local' },
    pin: { kind: 'local' },
    evidence: [],
  };

  await ctx.seed.overCapDone(verdict);

  const verdicts = await ctx.readVerdicts();

  expect(verdicts.get('checkout')).toStrictEqual(verdict);
});

test('it reads a verdict recorded before version 2 as missing', async () => {
  const ctx = await setupTest();

  await ctx.seed.overCapDone({
    feature: 'checkout',
    fingerprint: 'b'.repeat(40),
    run: 'mf3k2a-7q1z',
    at: '2026-11-04T10:00:00.000Z',
    evidence: [],
  });

  const verdicts = await ctx.readVerdicts();

  expect([...verdicts.keys()]).toStrictEqual([]);
});
