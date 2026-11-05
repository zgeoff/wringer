export type StatementTimeoutStep =
  | { readonly kind: 'expired' }
  | { readonly kind: 'set'; readonly timeoutMs: number }
  | { readonly kind: 'run' };

// Setting the timeout takes a round trip, which a slow database can stretch past the deadline, so
// the time left is read again after each one. The statement runs once the timeout set is no more
// than this over the time left.
const statementTimeoutSlackMs = 50;

// `setMs` is the statement timeout the connection holds, or null before the first one is set.
export function pickStatementTimeoutStep(
  setMs: number | null,
  aborted: boolean,
  timeLeftMs: number,
): StatementTimeoutStep {
  const leftMs = Math.floor(timeLeftMs);

  if (aborted || leftMs < 1) {
    return { kind: 'expired' };
  }

  if (setMs !== null && setMs - leftMs <= statementTimeoutSlackMs) {
    return { kind: 'run' };
  }

  return { kind: 'set', timeoutMs: leftMs };
}
