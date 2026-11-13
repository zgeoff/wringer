import type { PullRequestFound, PullRequestView } from './types.ts';
import { WringerError } from './wringer-error.ts';

export type PullRequestPick =
  | { readonly ok: true; readonly pr: PullRequestView }
  | { readonly ok: false; readonly failure: WringerError };

// The one open PR a publish writes to. `isByNumber` is true when `--pr` named it, which finds a PR
// in any state.
export function pickPullRequest(found: PullRequestFound, isByNumber: boolean): PullRequestPick {
  if (found.kind === 'none') {
    return {
      ok: false,
      failure: new WringerError('environment', {
        message: 'The current branch has no open pull request.',
        hint: 'Open the pull request, or pass `--pr <number>`.',
      }),
    };
  }

  if (found.kind === 'many') {
    return {
      ok: false,
      failure: new WringerError('environment', {
        message: `The current branch has several open pull requests: ${found.numbers.join(', ')}.`,
        hint: 'Pass `--pr <number>` to name one.',
      }),
    };
  }

  if (isByNumber && found.pr.state !== 'open') {
    return {
      ok: false,
      failure: new WringerError('environment', {
        message: `Pull request ${found.pr.number} is ${found.pr.state}.`,
        hint: 'Pass the number of an open pull request.',
      }),
    };
  }

  return { ok: true, pr: found.pr };
}
