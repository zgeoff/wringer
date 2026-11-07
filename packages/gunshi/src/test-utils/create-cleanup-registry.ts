export interface CleanupRegistry {
  readonly register: (cleanup: () => void) => void;

  // Runs each cleanup registered so far once, in the order registered.
  readonly runAll: () => void;
}

export function createCleanupRegistry(): CleanupRegistry {
  const cleanups: (() => void)[] = [];

  return {
    register: (cleanup) => {
      cleanups.push(cleanup);
    },
    runAll: () => {
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    },
  };
}
