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

// Setting the timeout takes a round trip, which a slow database can stretch past the deadline, so
// the time left is read again after each one. The statement runs once the timeout set is no more
// than this over the time left.
const statementTimeoutSlackMs = 50;

// A round trip that keeps growing would set the timeout forever. Past this many, the statement runs
// with the last timeout, and the cancel at the deadline stops it.
const maxTimeoutSets = 3;

// `previous` is the last timeout the connection set, or null before the first one.
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

  if (previous.timeoutMs - leftMs <= statementTimeoutSlackMs || previous.sets >= maxTimeoutSets) {
    return { kind: 'run' };
  }

  // The next set takes about as long as the last, so the timeout leaves out one more round trip.
  const timeoutMs = leftMs - (previous.leftMs - leftMs);

  if (timeoutMs < 1) {
    return { kind: 'expired' };
  }

  return { kind: 'set', timeoutMs, leftMs, sets: previous.sets + 1 };
}
