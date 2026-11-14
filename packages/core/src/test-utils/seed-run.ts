import type { StatePort } from '../state/create-file-state.ts';

export async function seedRun(state: StatePort, runID: string): Promise<void> {
  await state.appendEvent(runID, {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'box',
    mode: 'attach',
    fingerprint: 'empty',
  });
}
