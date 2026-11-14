export interface CleanupFacts {
  readonly launched: boolean;
  readonly serviceKeys: readonly string[];

  // Each part whose stop has already started.
  readonly stopping: ReadonlySet<string>;
}

export interface PendingCleanups {
  readonly app: readonly string[];
  readonly services: readonly string[];
}

const appCleanupKey = 'app';

// Each part that is up and not yet stopping. The app stops before the services, so a service that
// records its log, such as a stream recorder, sees its last lines.
export function pickPendingCleanups(facts: CleanupFacts): PendingCleanups {
  return {
    app: facts.launched && !facts.stopping.has(appCleanupKey) ? [appCleanupKey] : [],
    services: facts.serviceKeys.filter((key) => !facts.stopping.has(key)),
  };
}
