import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeRepoHost } from './create-node-repo-host.ts';
import { createRepoState } from './create-repo-state.ts';
import { readVerdicts } from './read-verdicts.ts';
import type { Verdict } from './report-schema.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'read-verdicts');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const state = createRepoState(root, '.wringer');

  return {
    state,
    readVerdicts: () => readVerdicts(state, createNodeRepoHost(), root),

    // A `done` envelope over the data cap, whose data sits in a payload file.
    seedOverCapDone: async (verdict: unknown) => {
      await mkdir(join(root, '.wringer', 'payloads'), { recursive: true });
      await writeFile(join(root, '.wringer', 'payloads', 'done.json'), JSON.stringify(verdict));

      await state.appendEvent('mf3k2a-7q1z', {
        type: 'run-started',
        at: '2026-11-04T09:59:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f1',
      });

      await state.appendEvent('mf3k2a-7q1z', {
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
    },
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

  await ctx.seedOverCapDone(verdict);

  const verdicts = await ctx.readVerdicts();

  expect(verdicts.get('checkout')).toStrictEqual(verdict);
});

test('it reads a verdict recorded before version 2 as missing', async () => {
  const ctx = await setupTest();

  await ctx.seedOverCapDone({
    feature: 'checkout',
    fingerprint: 'b'.repeat(40),
    run: 'mf3k2a-7q1z',
    at: '2026-11-04T10:00:00.000Z',
    evidence: [],
  });

  const verdicts = await ctx.readVerdicts();

  expect([...verdicts.keys()]).toStrictEqual([]);
});
