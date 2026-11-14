import type { StatementTimeoutStep } from '../sql-client/pick-statement-timeout-step.ts';
import { pickStatementTimeoutStep } from '../sql-client/pick-statement-timeout-step.ts';

// Each round trip takes the given time off the time left, as the driver's clock shows it.
export function collectStatementTimeoutSteps(
  startMs: number,
  roundTripsMs: readonly number[],
): StatementTimeoutStep[] {
  const steps: StatementTimeoutStep[] = [];
  let leftMs = startMs;
  let step = pickStatementTimeoutStep(null, false, leftMs);

  steps.push(step);

  for (const roundTripMs of roundTripsMs) {
    if (step.kind !== 'set') {
      break;
    }

    leftMs -= roundTripMs;
    step = pickStatementTimeoutStep(step, false, leftMs);

    steps.push(step);
  }

  return steps;
}
