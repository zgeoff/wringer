import { toWringerError } from '../to-wringer-error.ts';
import type { ProcessResult } from './run-process.ts';

// Names the first stop that failed to run or exited non-zero, or null when every stop worked.
export function findRemoteStopFailure(
  stops: readonly PromiseSettledResult<ProcessResult>[],
): string | null {
  for (const stop of stops) {
    if (stop.status === 'rejected') {
      return toWringerError(stop.reason).message;
    }

    if (stop.value.exitCode !== 0) {
      return `the stop exited with code ${stop.value.exitCode}: ${stop.value.stderr.trim()}`;
    }
  }

  return null;
}
