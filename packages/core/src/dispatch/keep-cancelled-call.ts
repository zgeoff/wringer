// Keeps a call in `cancelled` only when the command's deadline fires while the call still runs. A
// call that failed earlier, such as at a doctor check's own deadline, never answers for the timeout.
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
