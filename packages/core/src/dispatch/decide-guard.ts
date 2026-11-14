import type { RunView } from '../state/build-run-view.ts';
import type { Mode } from '../state/run-event.ts';
import { WringerError } from '../wringer-error.ts';

export interface GuardInput {
  readonly needsRun: boolean;
  readonly needsDoctor: boolean;
  readonly run: RunView | undefined;
  readonly targetName: string;
  readonly mode: Mode;
  readonly fingerprintChanged: boolean;
}

// The doctor fails closed: a drive command runs only on a running run whose own log holds a doctor
// pass. A launched app runs this worktree's code, so its pass also needs the tree unchanged since
// launch; an attached app runs code from elsewhere.
export function decideGuard(input: GuardInput): WringerError | null {
  const start = input.mode === 'launch' ? 'up' : 'attach';

  if (input.needsRun && input.run?.status !== 'running') {
    return new WringerError('not-running', {
      message: `Target ${input.targetName} has no running run.`,
      hint: `Run \`${start} --target ${input.targetName}\` first.`,
    });
  }

  if (!input.needsDoctor) {
    return null;
  }

  if (input.run?.doctor !== 'passed') {
    return new WringerError('doctor-required', {
      message: `The doctor has not passed on run ${input.run?.runID ?? 'none'}.`,
      hint: `Run \`doctor --target ${input.targetName}\`, and fix what it reports.`,
    });
  }

  if (input.fingerprintChanged) {
    return new WringerError('doctor-required', {
      message:
        'The working tree changed since this run started, so its doctor pass no longer holds.',
      hint: 'Run `up --restart`, then `doctor`.',
    });
  }

  return null;
}
