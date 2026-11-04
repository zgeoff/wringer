import { match } from 'ts-pattern';
import type { RunEventType } from './run-events.ts';

export type RunStatus = 'starting' | 'running' | 'crashed' | 'ended';

// A run's status lives only in its log, as events. These are the moves an event may make; the
// log's readers ignore a late event that would make any other move.
const runStatusMoves: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  starting: ['running', 'crashed', 'ended'],
  running: ['crashed', 'ended'],
  crashed: ['ended'],
  ended: [],
};

export function canMoveRunStatus(from: RunStatus, to: RunStatus): boolean {
  return runStatusMoves[from].includes(to);
}

export function findRunStatusMove(eventType: RunEventType): RunStatus | null {
  return match(eventType)
    .returnType<RunStatus | null>()
    .with('launch-ready', () => 'running')
    .with('crashed', () => 'crashed')
    .with('run-ended', () => 'ended')
    .with(
      'run-started',
      'supervisor-ready',
      'service-ready',
      'doctor-passed',
      'doctor-failed',
      'envelope',
      () => null,
    )
    .exhaustive();
}
