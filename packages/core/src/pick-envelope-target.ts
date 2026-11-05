import type { RunView } from './build-run-view.ts';

// A lifecycle command that bound its envelope to a run reports that run's target, even when another
// command moved the target pointer meanwhile; any other command reports its settled context's.
export function pickEnvelopeTarget(
  settled: { readonly targetName: string } | null,
  bound: RunView | null,
): string | null {
  return bound?.target ?? settled?.targetName ?? null;
}
