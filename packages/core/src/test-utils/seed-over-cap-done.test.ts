import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createRepoState } from '../state/create-repo-state.ts';
import { seedOverCapDone } from './seed-over-cap-done.ts';

function setupTest() {
  const root = createTempDir('seed-over-cap-done').path;

  return {
    root,
    state: createRepoState(root, '.wringer'),
    readPayload: async (): Promise<unknown> => {
      const text = await readFile(join(root, '.wringer', 'payloads', 'done.json'), 'utf8');

      return JSON.parse(text);
    },
  };
}

test('it writes the verdict to the payload file', async () => {
  const ctx = setupTest();

  await seedOverCapDone(ctx.root, ctx.state, { feature: 'pantry' });

  const payload = await ctx.readPayload();

  expect(payload).toStrictEqual({ feature: 'pantry' });
});

test('it records a started run and a truncated done envelope that points at the payload', async () => {
  const ctx = setupTest();

  await seedOverCapDone(ctx.root, ctx.state, { feature: 'pantry' });

  const events = await ctx.state.readRunEvents('mf3k2a-7q1z');

  expect(events).toStrictEqual([
    expect.objectContaining({ type: 'run-started' }),
    expect.objectContaining({
      type: 'envelope',
      envelope: expect.objectContaining({
        command: 'done',
        data: null,
        truncated: true,
        truncatedPath: '.wringer/payloads/done.json',
      }),
    }),
  ]);
});
