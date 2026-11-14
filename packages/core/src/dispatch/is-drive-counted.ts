import { match } from 'ts-pattern';
import { findOwnValue } from '../find-own-value.ts';
import type { RunView } from '../state/build-run-view.ts';
import type { Pointers } from '../state/create-file-state.ts';
import type { DriveReason } from './pick-command-plan.ts';

export interface DriveStart {
  readonly targetName: string;
  readonly run: RunView | undefined;
  readonly feature: string | null;
}

export interface DriveCurrent {
  // Read under the pointers' lock that the envelope's log append holds.
  readonly pointers: Pointers;
  readonly sessionFeature: string | undefined;
}

// A command the feature names checks the feature without touching the run, so nothing pins it to
// the run and feature it started under. It counts only when the doctor had passed on that run when
// it started, and that run and that feature are still current when its envelope is logged.
export function isDriveCounted(
  reason: DriveReason,
  started: DriveStart | null,
  current: DriveCurrent,
): boolean {
  return match(reason)
    .with('app', () => true)
    .with('none', () => false)
    .with(
      'feature-command',
      () =>
        started?.run?.doctor === 'passed' &&
        findOwnValue(current.pointers.currentRun, started.targetName) === started.run.runID &&
        (current.sessionFeature ?? current.pointers.feature ?? null) === started.feature,
    )
    .exhaustive();
}
