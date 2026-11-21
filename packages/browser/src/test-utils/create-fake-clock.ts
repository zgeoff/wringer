export interface FakeClock {
  readonly nowMs: () => number;

  // Settles after `delayMs` of fake time, and rejects when `signal` aborts first.
  readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  // Runs `work` to its end, moving fake time to the next timer whenever nothing else can run.
  readonly runUntilSettled: <T>(work: Promise<T>) => Promise<T>;
}

interface Timer {
  readonly atMs: number;
  readonly resolve: () => void;
}

export function createFakeClock(): FakeClock {
  let currentMs = 0;
  let timers: Timer[] = [];

  return {
    nowMs: () => currentMs,
    wait: (delayMs, signal) => {
      const deferred = Promise.withResolvers<void>();
      const timer: Timer = { atMs: currentMs + delayMs, resolve: deferred.resolve };

      timers.push(timer);

      signal.addEventListener(
        'abort',
        () => {
          timers = timers.filter((candidate) => candidate !== timer);

          deferred.reject(new Error('aborted'));
        },
        { once: true },
      );

      return deferred.promise;
    },
    runUntilSettled: async (work) => {
      let settled = false;

      const run = async () => {
        try {
          return await work;
        } finally {
          settled = true;
        }
      };

      const result = run();

      const advance = async () => {
        for (;;) {
          await Bun.sleep(0);

          const [next] = timers.toSorted((first, second) => first.atMs - second.atMs);

          if (settled || next === undefined) {
            return;
          }

          timers = timers.filter((candidate) => candidate !== next);
          currentMs = Math.max(currentMs, next.atMs);

          next.resolve();
        }
      };

      const [value] = await Promise.all([result, advance()]);

      return value;
    },
  };
}
