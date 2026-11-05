import type { LateFailureEvent, RunID } from './run-events.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { WringerError } from './wringer-error.ts';

export interface LateFailureFacts {
  readonly runID: RunID | null;
  readonly command: string;
  readonly answered: WringerError | null;
  readonly at: Date;
}

export interface LateFailureWrite {
  // With no run, the state folder's late-failure log takes the event.
  readonly runID: RunID | null;
  readonly event: LateFailureEvent;
}

// Null when the work succeeded, or failed with the error the envelope already answered with.
export function pickLateFailureWrite(
  settled: PromiseSettledResult<unknown>,
  facts: LateFailureFacts,
): LateFailureWrite | null {
  if (settled.status === 'fulfilled' || settled.reason === facts.answered) {
    return null;
  }

  const failure = toWringerError(settled.reason);

  return {
    runID: facts.runID,
    event: {
      type: 'late-failure',
      at: facts.at.toISOString(),
      command: facts.command,
      code: failure.code,
      message: failure.message,
    },
  };
}
