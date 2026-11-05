import type { StatePort } from './create-file-state.ts';
import { pickLateFailureWrite } from './pick-late-failure-write.ts';
import type { RunID } from './run-events.ts';
import type { WringerError } from './wringer-error.ts';

export interface LateFailureRequest {
  readonly state: StatePort;

  // The run whose log takes the failure; with none, the state folder's late-failure log takes it.
  readonly runID: RunID | null;
  readonly command: string;

  // The failure the envelope already answered with, which is no late failure.
  readonly answered: WringerError | null;
  readonly now: () => Date;
}

// The envelope answers at the deadline, but the command's work runs on, and its cleanup, such as
// an ssh remote stop, can fail after the answer. Only a log can still record that.
export async function writeLateFailure(
  work: Promise<unknown>,
  request: LateFailureRequest,
): Promise<void> {
  const [settled] = await Promise.allSettled([work]);

  const plan = pickLateFailureWrite(settled, { ...request, at: request.now() });

  if (plan === null) {
    return;
  }

  const writing =
    plan.runID === null
      ? request.state.appendLateFailure(plan.event)
      : request.state.appendEvent(plan.runID, plan.event);

  await writing.catch(() => {
    // Nothing is left to tell once the log refuses the write.
  });
}
