export interface StubClock {
  readonly nowMs: () => number;
  readonly sleep: (durationMs: number) => Promise<void>;
}

// A sleep moves the clock on by its duration and returns at once, so a timeout passes without
// real waiting.
export function buildStubClock(startMs: number): StubClock {
  let nowMs = startMs;

  return {
    nowMs: () => nowMs,
    sleep: (durationMs) => {
      nowMs += durationMs;

      return Promise.resolve();
    },
  };
}
