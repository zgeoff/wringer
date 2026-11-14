import type { RunStatus } from '../state/append-run-event.ts';
import type { SupervisorReach } from './call-run-supervisor.ts';

// What `up` has learned so far: the current run's status, and the answers of each call it made.
export interface StartFacts {
  readonly status: RunStatus | null;
  readonly restart: boolean;
  readonly ping: SupervisorReach | null;
  readonly stop: SupervisorReach | null;
}

export type StartAction = 'ping' | 'stop' | 'reuse' | 'mark-crashed' | 'start';

// `up` calls this after each step until it reuses the run or starts a new one. A run still
// starting is one an earlier `up` gave up waiting for; it is replaced, never reused, so its app and
// services are stopped first. A run whose supervisor is gone is marked crashed before the new start.
export function pickStartAction(facts: StartFacts): StartAction {
  if (facts.status !== 'running' && facts.status !== 'starting') {
    return 'start';
  }

  if (facts.ping === null) {
    return 'ping';
  }

  if (facts.ping === 'gone' || facts.stop === 'gone') {
    return 'mark-crashed';
  }

  if (facts.status === 'running' && !facts.restart) {
    return 'reuse';
  }

  return facts.stop === null ? 'stop' : 'start';
}
