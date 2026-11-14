import type { WringerError } from '../wringer-error.ts';

// Waits for every write of a collected secret, and returns the first failure, or null. A secret that
// is not kept would leak from the next process, so the command fails with it.
export async function readSecretWriteFailure(
  writes: readonly Promise<WringerError | null>[],
): Promise<WringerError | null> {
  const failures = await Promise.all(writes);

  return failures.find((failure) => failure !== null) ?? null;
}
