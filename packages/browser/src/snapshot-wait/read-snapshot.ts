import type { PageSnapshot } from '../browser.ts';
import { buildSnapshotWaitError } from './build-snapshot-wait-error.ts';
import type { SnapshotTextConditions } from './collect-unmet-conditions.ts';
import { waitForSnapshotText } from './wait-for-snapshot-text.ts';
import type { SnapshotTextWaitDependencies } from './wait-for-snapshot-text.ts';

export interface SnapshotReadDependencies extends SnapshotTextWaitDependencies {
  readonly actionTimeoutMs: number;
  readonly writeSnapshot: (text: string) => Promise<void>;
}

// Keeps the snapshot it returns as evidence once. With a text to wait for, a timeout keeps the last
// finished snapshot, if any, and fails.
export async function readSnapshot(
  request: SnapshotTextConditions,
  dependencies: SnapshotReadDependencies,
): Promise<PageSnapshot> {
  if (request.untilText === undefined && request.untilNoText === undefined) {
    const snapshot = await dependencies.takeSnapshot();

    await dependencies.writeSnapshot(snapshot.snapshot);

    return snapshot;
  }

  const outcome = await waitForSnapshotText(
    { ...request, actionTimeoutMs: dependencies.actionTimeoutMs },
    dependencies,
  );

  if (outcome.kind === 'timed-out') {
    if (outcome.last !== null) {
      await dependencies.writeSnapshot(outcome.last.snapshot);
    }

    throw buildSnapshotWaitError(outcome);
  }

  await dependencies.writeSnapshot(outcome.snapshot.snapshot);

  return outcome.snapshot;
}
