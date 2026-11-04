import type { RunView } from './build-run-view.ts';

export interface EnvelopeRunContext {
  readonly targetName: string;
  readonly run: RunView | undefined;
}

// `down` clears the pointer to the run it ended, so its envelope names that run from before the
// command. A command that moved to another target names only that target's run.
export function pickEnvelopeRun(
  before: EnvelopeRunContext | null,
  settled: EnvelopeRunContext | null,
): RunView | undefined {
  if (settled?.targetName !== before?.targetName) {
    return settled?.run;
  }

  return settled?.run ?? before?.run;
}
