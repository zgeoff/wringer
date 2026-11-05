import type { DoctorState } from './build-run-view.ts';
import type { Mode } from './run-events.ts';

export interface CommandNeedsFacts {
  readonly isBuiltin: boolean;
  readonly needsRun: boolean | undefined;
  readonly needsDoctor: boolean | undefined;
  readonly mode: Mode;
  readonly doctor: DoctorState | undefined;
}

export interface CommandNeeds {
  readonly needsRun: boolean;
  readonly needsDoctor: boolean;
  readonly readsFingerprint: boolean;
}

// A command that declares nothing needs a run and a doctor pass unless it is a built-in. A launched
// app runs this worktree's code, so only a doctor pass on a launched run needs the fingerprint.
export function pickCommandNeeds(facts: CommandNeedsFacts): CommandNeeds {
  const needsRun = facts.needsRun ?? !facts.isBuiltin;
  const needsDoctor = facts.needsDoctor ?? !facts.isBuiltin;

  return {
    needsRun,
    needsDoctor,
    readsFingerprint: needsDoctor && facts.mode === 'launch' && facts.doctor === 'passed',
  };
}
