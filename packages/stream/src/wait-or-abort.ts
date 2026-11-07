import { setTimeout } from 'node:timers/promises';

// Settles after the delay, or as soon as the signal aborts, and never rejects: a poll loop checks
// the signal itself after each wait.
export async function waitOrAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  await setTimeout(delayMs, undefined, { signal }).catch(() => null);
}
