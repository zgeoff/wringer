import { WringerError } from './wringer-error.ts';

// The first failure of a cancelled service call other than its timeout, such as a browser that
// could not close the page of a cancelled action, which tells the caller the action may still run.
export function findCancelFailure(
  settled: readonly PromiseSettledResult<unknown>[],
): WringerError | null {
  for (const result of settled) {
    if (
      result.status === 'rejected' &&
      result.reason instanceof WringerError &&
      result.reason.code !== 'timeout'
    ) {
      return result.reason;
    }
  }

  return null;
}
