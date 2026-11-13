import { WringerError } from './wringer-error.ts';

export interface GitHubFailureInput {
  readonly status: number;
  readonly isWrite: boolean;
}

// Maps an HTTP status that GitHub answered to the error a command reports. The message states the
// meaning and never the response, which a proxy could fill with the request's headers.
export function pickGitHubFailure(input: GitHubFailureInput): WringerError {
  if (input.status === 401) {
    return new WringerError('environment', {
      message: 'The GitHub token is not valid.',
      hint: 'Set GITHUB_TOKEN to a valid token, or run `gh auth login`.',
    });
  }

  if (input.status === 403 || input.status === 404) {
    return new WringerError('environment', {
      message: 'The GitHub token cannot reach this pull request.',
      hint: 'Check the pull request number, and that the token can read and write pull requests in the repo.',
    });
  }

  if (input.status === 422 && input.isWrite) {
    return new WringerError('environment', {
      message: 'GitHub refused the description.',
      hint: 'The description may be longer than GitHub allows.',
    });
  }

  return new WringerError('environment', {
    message: `GitHub answered HTTP ${input.status}.`,
  });
}
