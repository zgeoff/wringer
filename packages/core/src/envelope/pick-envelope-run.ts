import type { RunView } from '../state/build-run-view.ts';

export interface EnvelopeRunContext {
  readonly targetName: string;
  readonly run: RunView | undefined;
}

// A lifecycle command's envelope belongs to the run it bound under the target's lock. `down` clears
// the pointer to the run it ended, so its envelope names that run from before the command, and a
// command that moved to another target names only that target's run.
export function pickEnvelopeRun(
  before: EnvelopeRunContext | null,
  settled: EnvelopeRunContext | null,
  bound: RunView | null,
): RunView | undefined {
  if (bound !== null) {
    return bound;
  }

  if (settled?.targetName !== before?.targetName) {
    return settled?.run;
  }

  return settled?.run ?? before?.run;
}
