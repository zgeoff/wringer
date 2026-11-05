import type { StatePort } from './create-file-state.ts';
import type { LateFailureEvent, RunID } from './run-events.ts';
import { toWringerError } from './to-wringer-error.ts';
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

  if (settled.status === 'fulfilled' || settled.reason === request.answered) {
    return;
  }

  const failure = toWringerError(settled.reason);

  const event: LateFailureEvent = {
    type: 'late-failure',
    at: request.now().toISOString(),
    command: request.command,
    code: failure.code,
    message: failure.message,
  };

  const writing =
    request.runID === null
      ? request.state.appendLateFailure(event)
      : request.state.appendEvent(request.runID, event);

  await writing.catch(() => {
    // Nothing is left to tell once the log refuses the write.
  });
}
