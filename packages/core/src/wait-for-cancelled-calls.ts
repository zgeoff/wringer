import { supervisorCancelWaitMs } from './call-supervisor.ts';
import { findCancelFailure } from './find-cancel-failure.ts';
import { raceDeadline } from './race-deadline.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { WringerError } from './wringer-error.ts';

// A service call the deadline cancelled, such as a browser action, answers once its work has
// stopped. Resolves within a bound with the failure of a cancel that could not stop its work.
export async function waitForCancelledCalls(
  calls: readonly Promise<unknown>[],
): Promise<WringerError | null> {
  const failures: WringerError[] = [];

  const watch = async (call: Promise<unknown>): Promise<void> => {
    try {
      await call;
    } catch (error) {
      failures.push(toWringerError(error));
    }
  };

  const watched = Promise.all(calls.map((call) => watch(call)));

  await Promise.allSettled([raceDeadline(watched, AbortSignal.timeout(supervisorCancelWaitMs))]);

  return findCancelFailure(failures);
}
