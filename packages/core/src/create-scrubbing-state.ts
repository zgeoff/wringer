import type { StatePort } from './create-file-state.ts';
import type { SecretSet } from './create-secret-set.ts';
import type { RunID } from './run-events.ts';
import { scrubRunEvent } from './scrub-run-event.ts';

export interface ScrubbingStateOptions {
  // Runs before each run-log append, such as to load what another process kept for the run.
  readonly beforeAppend?: ((runID: RunID) => Promise<void>) | undefined;
}

// The state port with every append scrubbed by the set as it stands when the append is written: the
// run log and the late-failures file. Every other call reaches the port unchanged.
export function createScrubbingState(
  state: StatePort,
  secrets: SecretSet,
  options: ScrubbingStateOptions = {},
): StatePort {
  return {
    ...state,
    appendEvent: async (runID, event) => {
      await options.beforeAppend?.(runID);

      return state.appendEvent(runID, scrubRunEvent(event, secrets));
    },
    appendEventUnless: async (runID, event, refuse) => {
      await options.beforeAppend?.(runID);

      return state.appendEventUnless(runID, scrubRunEvent(event, secrets), refuse);
    },
    appendLateFailure: (event) => {
      const scrubbed = {
        ...event,
        command: secrets.scrubText(event.command),
        message: secrets.scrubText(event.message),
      };

      return state.appendLateFailure(scrubbed);
    },
  };
}
