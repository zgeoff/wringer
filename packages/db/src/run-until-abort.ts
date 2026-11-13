// Ends the wait when the signal aborts. The promise left behind settles on its own, or when its
// client closes, and a failure of it is ignored.
export async function runUntilAbort<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
  buildError: () => Error,
): Promise<T> {
  const settled = Promise.allSettled([promise]);
  const aborted = Promise.withResolvers<never>();

  const onAbort = (): void => {
    aborted.reject(buildError());
  };

  if (signal.aborted) {
    onAbort();
  }

  signal.addEventListener('abort', onAbort, { once: true });

  try {
    return await Promise.race([promise, aborted.promise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    void settled;
  }
}
