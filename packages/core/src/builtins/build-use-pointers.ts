import type { Pointers } from '../state/create-file-state.ts';
import type { RunID } from '../state/run-event.ts';

export interface UseChange {
  readonly target: string | undefined;
  readonly feature: string | undefined;

  // The cursors of the run the pointers name after the change, or none when it names no run.
  readonly cursors: Readonly<Record<string, number>>;
  readonly runID: RunID | undefined;
}

// `use` keeps each pointer it is not given, and replaces the cursors with those of the run the
// new target points at.
export function buildUsePointers(current: Pointers, change: UseChange): Pointers {
  const target = change.target ?? current.target;
  const feature = change.feature ?? current.feature;

  return {
    currentRun: current.currentRun,
    ...(target === undefined ? {} : { target }),
    ...(feature === undefined ? {} : { feature }),
    cursors: { ...change.cursors },
    ...(change.runID === undefined ? {} : { cursorsRun: change.runID }),
  };
}
