export interface SetTimeoutStep {
  readonly kind: 'set';
  readonly timeoutMs: number;

  // The time left when this step was picked, before its round trip.
  readonly leftMs: number;

  // How many timeouts this step makes the connection set, counting this one.
  readonly sets: number;

  // The slowest round trip any step so far took.
  readonly slowestMs: number;
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
    return { kind: 'set', timeoutMs: leftMs, leftMs, sets: 1, slowestMs: 0 };
  }

  if (previous.timeoutMs <= leftMs) {
    return { kind: 'run' };
  }

  const slowestMs = Math.max(previous.slowestMs, previous.leftMs - leftMs);

  if (previous.sets > maxTimeoutSets) {
    return { kind: 'expired' };
  }

  if (previous.sets === maxTimeoutSets) {
    return pickFallbackStep(slowestMs, leftMs, previous.sets);
  }

  // The next set takes about as long as the last, so the timeout leaves out two round trips: the
  // set's own, and room for one that runs slower.
  const timeoutMs = leftMs - 2 * (previous.leftMs - leftMs);

  if (timeoutMs < 1) {
    return { kind: 'expired' };
  }

  return { kind: 'set', timeoutMs, leftMs, sets: previous.sets + 1, slowestMs };
}

// Round trips that vary can use up the sets with most of the time left. One last set, from the
// slowest round trip seen, then follows, but only while that round trip is under this share of the
// time left; a database slower than that fails the query.
const maxFallbackShare = 0.1;

function pickFallbackStep(slowestMs: number, leftMs: number, sets: number): StatementTimeoutStep {
  const timeoutMs = leftMs - 2 * slowestMs;

  if (slowestMs > leftMs * maxFallbackShare || timeoutMs < 1) {
    return { kind: 'expired' };
  }

  return { kind: 'set', timeoutMs, leftMs, sets: sets + 1, slowestMs };
}
