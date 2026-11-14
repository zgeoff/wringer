import type { StatePort } from '../state/create-file-state.ts';
import type { RunID } from '../state/run-event.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { WringerError } from '../wringer-error.ts';

// The envelope still answers when the run's cursors cannot be read, and carries that failure.
export async function readEnvelopeCursors(
  state: StatePort,
  runID: RunID,
): Promise<Record<string, number> | WringerError> {
  try {
    return await state.readCursors(runID);
  } catch (error) {
    return toWringerError(error);
  }
}
