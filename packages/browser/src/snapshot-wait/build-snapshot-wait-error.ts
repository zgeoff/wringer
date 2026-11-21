import { WringerError } from '@wringer/core';

export interface SnapshotWaitTimeout {
  readonly waitedMs: number;
  readonly unmet: readonly string[];
}

export function buildSnapshotWaitError(timeout: SnapshotWaitTimeout): WringerError {
  const seconds = (timeout.waitedMs / 1000).toFixed(1);

  return new WringerError('check-failed', {
    message: `The page ${timeout.unmet.join(' and ')} after ${seconds} s.`,
    hint: 'Read the last snapshot in the evidence, `snapshot.yaml`, to see what the page showed.',
  });
}
