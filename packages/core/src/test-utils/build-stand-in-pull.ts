import type { StandInPull } from './create-github-stand-in.ts';

export function buildStandInPull(overrides: Partial<StandInPull> = {}): StandInPull {
  return {
    number: 7,
    head: 'feature',
    state: 'open',
    body: 'Hello',
    base: 'main',
    ...overrides,
  };
}
