import type { PageSnapshot } from '../browser.ts';
import { collectUnmetConditions } from './collect-unmet-conditions.ts';
import type { SnapshotTextConditions } from './collect-unmet-conditions.ts';

const pollEveryMs = 250;
const noSnapshotCondition = 'never finished a snapshot';

// The driver answers this long before the command's deadline, so the supervisor has not yet
// cancelled the page call.
const deadlineReserveMs = 2000;

export interface SnapshotTextWait extends SnapshotTextConditions {
  readonly actionTimeoutMs: number;
}

export interface SnapshotTextWaitDependencies {
  readonly takeSnapshot: () => Promise<PageSnapshot>;

  // Settles after `delayMs`, and rejects when `signal` aborts first.
  readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly timeLeftMs: () => number;
}

export type SnapshotTextWaitOutcome =
  | { readonly kind: 'matched'; readonly snapshot: PageSnapshot }
  | {
      readonly kind: 'timed-out';

      // Null when not even the first snapshot finished in time.
      readonly last: PageSnapshot | null;
      readonly waitedMs: number;
      readonly unmet: readonly string[];
    };

// Takes a snapshot at once, then again every 250 ms, until one holds the first text and lacks the
// second. A snapshot that stalls ends the wait like the time running out does, with the last
// snapshot that finished.
export async function waitForSnapshotText(
  request: SnapshotTextWait,
  dependencies: SnapshotTextWaitDependencies,
): Promise<SnapshotTextWaitOutcome> {
  const startLeftMs = dependencies.timeLeftMs();

  const readBudgetMs = (): number =>
    Math.min(
      request.actionTimeoutMs - (startLeftMs - dependencies.timeLeftMs()),
      dependencies.timeLeftMs() - deadlineReserveMs,
    );

  let last = await raceSnapshot(dependencies, readBudgetMs());

  let unmet =
    last === null ? [noSnapshotCondition] : collectUnmetConditions(last.snapshot, request);

  while (last !== null && unmet.length > 0) {
    const budgetMs = readBudgetMs();

    if (budgetMs <= pollEveryMs) {
      await dependencies.wait(Math.max(budgetMs, 0), new AbortController().signal);

      break;
    }

    await dependencies.wait(pollEveryMs, new AbortController().signal);

    const next = await raceSnapshot(dependencies, readBudgetMs());

    if (next === null) {
      break;
    }

    last = next;
    unmet = collectUnmetConditions(next.snapshot, request);
  }

  if (last !== null && unmet.length === 0) {
    return { kind: 'matched', snapshot: last };
  }

  return { kind: 'timed-out', last, waitedMs: startLeftMs - dependencies.timeLeftMs(), unmet };
}

async function raceSnapshot(
  dependencies: SnapshotTextWaitDependencies,
  budgetMs: number,
): Promise<PageSnapshot | null> {
  if (budgetMs <= 0) {
    return null;
  }

  const cancel = new AbortController();

  const expire = async (): Promise<null> => {
    try {
      await dependencies.wait(budgetMs, cancel.signal);
    } catch {
      return null;
    }

    return null;
  };

  try {
    return await Promise.race([dependencies.takeSnapshot(), expire()]);
  } finally {
    cancel.abort();
  }
}
