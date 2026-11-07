import type { WringerError } from './wringer-error.ts';

// The first failure of a cancelled service call other than its timeout, such as a browser that
// could not close the page of a cancelled action, which tells the caller the action may still run.
export function findCancelFailure(failures: readonly WringerError[]): WringerError | null {
  return failures.find((failure) => failure.code !== 'timeout') ?? null;
}
