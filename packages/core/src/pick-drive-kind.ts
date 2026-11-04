import type { RunStatus } from './run-log.ts';

export interface DriveFacts {
  readonly runStatus: RunStatus | null;
  readonly needsRun: boolean;
  readonly isRepoCommand: boolean;
}

export type DriveKind = 'run' | 'runless' | 'none';

// A command that needs a run drives it, and so does a repo command that needs none while a run is
// running, so it reaches the run's services. Any other repo command gets a drive with no run; a
// built-in or driver command that needs no run reaches no drive.
export function pickDriveKind(facts: DriveFacts): DriveKind {
  if (
    facts.runStatus !== null &&
    (facts.needsRun || (facts.isRepoCommand && facts.runStatus === 'running'))
  ) {
    return 'run';
  }

  return !facts.needsRun && facts.isRepoCommand ? 'runless' : 'none';
}
