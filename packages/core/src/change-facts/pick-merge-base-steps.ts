import { WringerError } from '../wringer-error.ts';
import type { GitRequest } from './run-git.ts';

export interface MergeBaseStepInput {
  readonly root: string;
  readonly base: string;

  // The text of `git rev-list --max-count=1 --all`: empty when the repo has no commit.
  readonly newestCommit: string;
}

export interface MergeBaseSteps {
  readonly verifyBase: GitRequest;
  readonly mergeBase: GitRequest;

  readonly noSharedCommit: WringerError;
}

// `merge-base` names no cause when HEAD is unborn or the base is missing, so a repo with no commit
// fails before it, and a missing base fails `verifyBase` with git's own message.
export function pickMergeBaseSteps(input: MergeBaseStepInput): MergeBaseSteps | WringerError {
  if (input.newestCommit.trim() === '') {
    return new WringerError('environment', {
      message: 'The repo has no commit yet, so its change has no fingerprint.',
      hint: 'Commit once, then run the command again.',
    });
  }

  return {
    verifyBase: { cwd: input.root, args: ['rev-parse', '--verify', `${input.base}^{commit}`] },
    mergeBase: { cwd: input.root, args: ['merge-base', 'HEAD', input.base] },
    noSharedCommit: new WringerError('environment', {
      message: `HEAD and ${input.base} share no commit in this clone, so the change has no fingerprint.`,
      hint: 'In a shallow clone, fetch more history, such as with `git fetch --unshallow`.',
    }),
  };
}
