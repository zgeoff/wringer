import type { RunView } from '../src/build-run-view.ts';

// A running launch run whose doctor passed, for tests of code that reads a run view.
export function buildMockRunView(overrides: Partial<RunView> = {}): RunView {
  return {
    runID: 'mf3k2a-7q1z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f1',
    status: 'running',
    startedAt: '2026-11-04T10:00:00.000Z',
    endedAt: null,
    crashReason: null,
    endpoints: {},
    services: [],
    supervisor: null,
    doctor: 'passed',
    doctorResults: [],
    drivesAfterDoctor: [],
    ...overrides,
  };
}
