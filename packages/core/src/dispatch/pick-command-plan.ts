import type { RunView } from '../state/build-run-view.ts';
import type { Mode } from '../state/run-event.ts';
import { WringerError } from '../wringer-error.ts';
import { decideGuard } from './decide-guard.ts';
import { pickDriveKind } from './pick-drive-kind.ts';
import type { DriveKind } from './pick-drive-kind.ts';

export interface CommandFacts {
  readonly needsRun: boolean;
  readonly needsDoctor: boolean;
  readonly isRepoCommand: boolean;
  readonly isFeatureCommand: boolean;
  readonly run: RunView | undefined;
  readonly targetName: string;
  readonly mode: Mode;
  readonly fingerprintChanged: boolean;
  readonly deadlinePassed: boolean;
}

// Why the command's envelope goes into the run's log as a drive: it drives the app, the current
// feature names it, or neither.
export type DriveReason = 'app' | 'feature-command' | 'none';

export type CommandPlan =
  | { readonly kind: 'refuse'; readonly failure: WringerError }
  | {
      readonly kind: 'run';
      readonly driveKind: DriveKind;
      readonly drive: DriveReason;
    };

// The envelope answers at the deadline without waiting for the command, so a body that would start
// after it never starts.
export function pickCommandPlan(facts: CommandFacts): CommandPlan {
  const refusal = decideGuard(facts);

  if (refusal !== null) {
    return { kind: 'refuse', failure: refusal };
  }

  if (facts.deadlinePassed) {
    return { kind: 'refuse', failure: new WringerError('timeout') };
  }

  return {
    kind: 'run',
    driveKind: pickDriveKind({
      runStatus: facts.run?.status ?? null,
      needsRun: facts.needsRun,
      isRepoCommand: facts.isRepoCommand,
    }),
    drive: pickDriveReason(facts),
  };
}

function pickDriveReason(facts: CommandFacts): DriveReason {
  if (facts.needsRun && facts.needsDoctor) {
    return 'app';
  }

  return facts.isFeatureCommand ? 'feature-command' : 'none';
}
