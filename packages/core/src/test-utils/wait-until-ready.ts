import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';

// The docker lane gives each test 15 s, setup included. A setup that starts a container keeps to
// this budget, so a slow start fails as not ready while the test still runs, and leaves the test
// the rest.
export const setupBudgetMs = 10_000;

export interface WaitUntilReadyOptions {
  // Names what the setup waits for, in the error.
  readonly label: string;

  readonly deadlineAtMs: number;

  // Aborts when the test ends, so no probe runs after its cleanup.
  readonly signal: AbortSignal;
}

// Calls probe until it returns true. Rejects with a "not ready" error once the deadline passes or
// the signal aborts, and starts no probe after either. Each probe gets a signal that aborts at
// the same moment, to stop an in-flight check.
export async function waitUntilReady(
  probe: (signal: AbortSignal) => Promise<boolean>,
  options: WaitUntilReadyOptions,
): Promise<void> {
  const remainingMs = Math.max(options.deadlineAtMs - Date.now(), 0);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(remainingMs)]);

  // waitFor retries every throw, so the stop comes back as a value.
  const outcome = await waitFor(
    async () => {
      if (signal.aborted) {
        return 'stopped';
      }

      const ready = await probe(signal);

      invariant(ready, `${options.label} is not ready`);

      return 'ready';
    },
    { timeoutMs: remainingMs, label: options.label },
  ).catch((error: unknown) => {
    throw new Error(`${options.label} was not ready before the setup budget ran out`, {
      cause: error,
    });
  });

  if (outcome === 'stopped') {
    throw new Error(`${options.label} was not ready before ${pickStopReason(options.signal)}`);
  }
}

function pickStopReason(testSignal: AbortSignal): string {
  return testSignal.aborted ? 'the test ended' : 'the setup budget ran out';
}

export function readRemainingMs(deadlineAtMs: number, step: string): number {
  const remainingMs = deadlineAtMs - Date.now();

  if (remainingMs <= 0) {
    throw new Error(`the setup budget ran out before ${step}`);
  }

  return remainingMs;
}
