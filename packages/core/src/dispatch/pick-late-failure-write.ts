import type { LateFailureEvent, RunID } from '../state/run-event.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { WringerError } from '../wringer-error.ts';

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

// Null when the work succeeded, failed with the error the envelope already answered with, or ran
// into the same deadline the envelope answered as a timeout, such as a body refused at its start.
export function pickLateFailureWrite(
  settled: PromiseSettledResult<unknown>,
  facts: LateFailureFacts,
): LateFailureWrite | null {
  if (settled.status === 'fulfilled' || settled.reason === facts.answered) {
    return null;
  }

  const failure = toWringerError(settled.reason);

  if (failure.code === 'timeout' && facts.answered?.code === 'timeout') {
    return null;
  }

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
