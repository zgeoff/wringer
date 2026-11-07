import type { Envelope } from '../envelope.ts';

// A passing drive's envelope on the local target, for tests of code that reads logged envelopes.
export function buildMockEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    wringer: 1,
    ok: true,
    command: 'action receipt',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: null,
    durationMs: 12,
    data: null,
    evidence: [],
    cursors: {},
    error: null,
    ...overrides,
  };
}
