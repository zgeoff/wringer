// Keeps a call in `cancelled` only when its signal aborts while the call still runs, so a call that
// failed before the deadline, which the command may have handled, never answers for the timeout.
export function keepCancelledCall(
  cancelled: Promise<unknown>[],
  calling: Promise<unknown>,
  signal: AbortSignal,
): void {
  const onAbort = (): void => {
    cancelled.push(calling);
  };

  signal.addEventListener('abort', onAbort, { once: true });

  const forget = async (): Promise<void> => {
    await Promise.allSettled([calling]);

    signal.removeEventListener('abort', onAbort);
  };

  void forget();
}
