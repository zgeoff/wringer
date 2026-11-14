import { raceDeadline } from '../race-deadline.ts';
import { buildUnconfirmedError, supervisorCancelWaitMs } from '../supervisor/call-supervisor.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { WringerError } from '../wringer-error.ts';
import { findCancelFailure } from './find-cancel-failure.ts';

// A call gives up on its supervisor's answer after its own wait, so this bound only ends a port
// that never settles.
const cancelBoundMs = supervisorCancelWaitMs + 1000;

// A service call the deadline cancelled, such as a browser action, answers once its work has
// stopped. Resolves with the failure of a cancel that could not stop its work, or null.
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

  const [settled] = await Promise.allSettled([
    raceDeadline(watched, AbortSignal.timeout(cancelBoundMs)),
  ]);

  if (settled.status === 'rejected') {
    failures.push(buildUnconfirmedError());
  }

  return findCancelFailure(failures);
}
