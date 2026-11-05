import type { RunEvent } from './run-events.ts';
import { WringerError } from './wringer-error.ts';

export interface ShutDownFacts {
  readonly crashReason: string | null;

  // True when the stop stopped waiting for a startup that ignored the abort.
  readonly gaveUpOnStartup: boolean;

  // Each part whose cleanup failed, with why.
  readonly failures: readonly string[];
  readonly at: string;
}

export interface ShutDownSteps {
  readonly abortCommands: boolean;
  readonly events: readonly RunEvent[];

  // What the stop's caller gets once the final events are written.
  readonly failure: WringerError | null;
}

// A cleanup the deadline gave up on can leave its command running, so the commands end only once
// every part that will ever stop has stopped. A cleanup that failed makes the stop a crash, so the
// log names what may still run.
export function buildShutDownSteps(facts: ShutDownFacts): ShutDownSteps {
  const reasons = [
    ...(facts.crashReason === null ? [] : [facts.crashReason]),
    ...(facts.failures.length === 0 ? [] : [`cleanup failed for ${facts.failures.join('; ')}`]),
  ];

  const event: RunEvent =
    reasons.length === 0
      ? { type: 'run-ended', at: facts.at }
      : { type: 'crashed', at: facts.at, reason: reasons.join('; ') };

  const failure =
    facts.failures.length === 0
      ? null
      : new WringerError('environment', {
          message: `The run ended, and a part may still be up. Cleanup failed for ${facts.failures.join('; ')}`,
          hint: 'Stop each part the message names by hand before the next `up`.',
        });

  return { abortCommands: !facts.gaveUpOnStartup, events: [event], failure };
}
