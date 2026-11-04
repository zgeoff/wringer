import type { RunView } from '../build-run-view.ts';
import type { SupervisorReach } from './call-run-supervisor.ts';
import type { StopData } from './stop-data-schema.ts';

export interface StopInput {
  readonly runID: string | undefined;
  readonly status: RunView['status'] | undefined;
  readonly reach: SupervisorReach;
}

export interface StopPlan {
  readonly data: StopData;
  readonly markCrashed: boolean;
  readonly clearPointer: boolean;
}

// A supervisor that answered the stop ended the run itself. One that is gone left a run that still
// reads as live, so the run is marked crashed and its log ends in a final status.
export function pickStopPlan(input: StopInput): StopPlan {
  if (input.runID === undefined) {
    return { data: { run: null, stopped: false }, markCrashed: false, clearPointer: false };
  }

  const stopped = input.reach === 'answered';
  const live = input.status === 'running' || input.status === 'starting';

  return {
    data: { run: input.runID, stopped },
    markCrashed: !stopped && live,
    clearPointer: true,
  };
}
