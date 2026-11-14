import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StatePort } from '../state/create-file-state.ts';

// A `done` envelope over the data cap, whose data sits in a payload file, in run mf3k2a-7q1z of a
// state folder at `.wringer` under the root.
export async function seedOverCapDone(
  root: string,
  state: StatePort,
  verdict: unknown,
): Promise<void> {
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
}
