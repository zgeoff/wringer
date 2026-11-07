import { supervisorCancelWaitMs } from './call-supervisor.ts';
import { findCancelFailure } from './find-cancel-failure.ts';
import { raceDeadline } from './race-deadline.ts';
import type { WringerError } from './wringer-error.ts';

// A service call the deadline cancelled, such as a browser action, answers once its work has
// stopped. Resolves once every call has, within a bound, with the failure of a cancel that could
// not stop its work, or null.
export async function waitForCancelledCalls(
  calls: readonly Promise<unknown>[],
): Promise<WringerError | null> {
  const [cancelled] = await Promise.allSettled([
    raceDeadline(Promise.allSettled(calls), AbortSignal.timeout(supervisorCancelWaitMs)),
  ]);

  return cancelled.status === 'fulfilled' ? findCancelFailure(cancelled.value) : null;
}
