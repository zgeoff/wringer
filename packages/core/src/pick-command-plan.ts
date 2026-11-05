import type { RunView } from './build-run-view.ts';
import { decideGuard } from './decide-guard.ts';
import { pickDriveKind } from './pick-drive-kind.ts';
import type { DriveKind } from './pick-drive-kind.ts';
import type { Mode } from './run-events.ts';
import { WringerError } from './wringer-error.ts';

export interface CommandFacts {
  readonly needsRun: boolean;
  readonly needsDoctor: boolean;
  readonly isRepoCommand: boolean;
  readonly run: RunView | undefined;
  readonly targetName: string;
  readonly mode: Mode;
  readonly fingerprintChanged: boolean;
  readonly deadlinePassed: boolean;
}

export type CommandPlan =
  | { readonly kind: 'refuse'; readonly failure: WringerError }
  | {
      readonly kind: 'run';
      readonly driveKind: DriveKind;

      // The command drives the app, so its envelope goes into the run's log as a drive.
      readonly drive: boolean;
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
    drive: facts.needsRun && facts.needsDoctor,
  };
}
