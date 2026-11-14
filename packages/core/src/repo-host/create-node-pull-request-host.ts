import { runGit } from '../change-facts/run-git.ts';
import { runProcess } from '../host/run-process.ts';
import type { PullRequestHost } from '../types.ts';
import { createGitHubPullRequestHost } from './create-github-pull-request-host.ts';

// The commands' view of the repo's GitHub pull requests, for an entry point to pass in.
export function createNodePullRequestHost(root: string): PullRequestHost {
  return createGitHubPullRequestHost({ root, env: process.env, runGit, runProcess, fetch });
}
