export interface WaitForOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

// Polls `probe` until it returns a value other than null, for state that another process changes,
// such as a file a recorder appends to. Rejects once the time is up.
export async function waitFor<T>(
  probe: () => T | null | Promise<T | null>,
  options: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();

    if (value !== null) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`waitFor gave up after ${timeoutMs} ms.`);
    }

    await Bun.sleep(options.intervalMs ?? 25);
  }
}
