import type { RunEvent } from '../state/run-event.ts';
import { WringerError } from '../wringer-error.ts';

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

const unfinishedStartup = 'the startup had not finished when the stop stopped waiting for it';

// A cleanup the deadline gave up on can leave its command running, so the commands of the parts
// that came up end only once every such part has stopped. A failed cleanup, or a startup the stop
// gave up on, makes the stop a crash, so the log and the stop's caller name what may still run.
export function buildShutDownSteps(facts: ShutDownFacts): ShutDownSteps {
  const leftovers = [
    ...(facts.gaveUpOnStartup ? [unfinishedStartup] : []),
    ...(facts.failures.length === 0 ? [] : [`cleanup failed for ${facts.failures.join('; ')}`]),
  ];

  const reasons = [...(facts.crashReason === null ? [] : [facts.crashReason]), ...leftovers];

  const event: RunEvent =
    reasons.length === 0
      ? { type: 'run-ended', at: facts.at }
      : { type: 'crashed', at: facts.at, reason: reasons.join('; ') };

  const failure =
    leftovers.length === 0
      ? null
      : new WringerError('environment', {
          message: `The run ended, and a part may still be up: ${leftovers.join('; ')}.`,
          hint: 'Stop each part the message names by hand before the next `up`.',
        });

  return {
    abortCommands: !facts.gaveUpOnStartup,
    events: [event],
    failure,
  };
}
