export interface SetTimeoutStep {
  readonly kind: 'set';
  readonly timeoutMs: number;

  // The time left when this step was picked, before its round trip.
  readonly leftMs: number;

  // How many timeouts this step makes the connection set, counting this one.
  readonly sets: number;
}

export type StatementTimeoutStep =
  | { readonly kind: 'expired' }
  | SetTimeoutStep
  | { readonly kind: 'run' };

// A cancel may never reach a role at its connection limit, so the database's own timeout is the
// only bound. The statement runs only under a timeout no longer than the time left; a database
// whose round trips keep growing fails the query rather than run it past its deadline.
const maxTimeoutSets = 3;

export function pickStatementTimeoutStep(
  previous: SetTimeoutStep | null,
  aborted: boolean,
  timeLeftMs: number,
): StatementTimeoutStep {
  const leftMs = Math.floor(timeLeftMs);

  if (aborted || leftMs < 1) {
    return { kind: 'expired' };
  }

  if (previous === null) {
    return { kind: 'set', timeoutMs: leftMs, leftMs, sets: 1 };
  }

  if (previous.timeoutMs <= leftMs) {
    return { kind: 'run' };
  }

  if (previous.sets >= maxTimeoutSets) {
    return { kind: 'expired' };
  }

  // The next set takes about as long as the last, so the timeout leaves out two round trips: the
  // set's own, and room for one that runs slower.
  const timeoutMs = leftMs - 2 * (previous.leftMs - leftMs);

  if (timeoutMs < 1) {
    return { kind: 'expired' };
  }

  return { kind: 'set', timeoutMs, leftMs, sets: previous.sets + 1 };
}
