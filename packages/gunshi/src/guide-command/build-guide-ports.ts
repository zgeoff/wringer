import {
  WringerError,
  createFileState,
  createNodeRepoHost,
  makeProcessSupervisorPort,
} from '@wringer/core';
import type { PullRequestHost, RepoHost, StateFileSystem } from '@wringer/core';
import type { CLIPorts } from '../run-cli.ts';

type RepoPorts = Pick<CLIPorts, 'readRepoRoot' | 'openRepo'>;

// The ports for a registry that needs no repo: the folder it runs in stands for the root, whether
// or not it is a git worktree, and no run state is read or written.
export function buildGuidePorts(selfCommand: readonly string[]): RepoPorts {
  return {
    readRepoRoot: (cwd) => Promise.resolve(cwd),
    openRepo: (root) => ({
      state: createFileState({
        stateDir: root,
        lockTimeoutMs: 1000,
        fs: buildEmptyFileSystem(),
      }),
      repoHost: buildGitlessRepoHost(),
      supervisor: makeProcessSupervisorPort({ selfCommand, root, stateDir: root }),
      pullRequests: buildRefusingPullRequestHost(),
    }),
  };
}

// A file system that holds nothing and takes no write, so `guide` reads no state from the folder it
// runs in and leaves none behind.
function buildEmptyFileSystem(): StateFileSystem {
  return {
    readText: () => Promise.resolve(null),
    listNames: () => Promise.resolve([]),
    readFileSize: () => Promise.resolve(0),
    createDirectory: () => Promise.resolve(),
    appendText: refuseWrite,
    appendPrivateText: refuseWrite,
    removeFile: refuseWrite,
    truncateFile: refuseWrite,
    writeTextAtomic: refuseWrite,
  };
}

function refuseWrite(): Promise<never> {
  return Promise.reject(
    new WringerError('environment', {
      message: 'The guide keeps no state.',
      hint: 'Run a repo command through the repo verify CLI.',
    }),
  );
}

// A host whose git always fails, so the dispatcher labels the envelope with no SHA and `guide`
// reads nothing outside the package, even inside a worktree.
function buildGitlessRepoHost(): RepoHost {
  return {
    ...createNodeRepoHost(),
    runGit: () =>
      Promise.reject(new WringerError('environment', { message: 'The guide reads no git.' })),
  };
}

function buildRefusingPullRequestHost(): PullRequestHost {
  return { findOpen: refusePullRequest, readBody: refusePullRequest, writeBody: refusePullRequest };
}

function refusePullRequest(): Promise<never> {
  return Promise.reject(
    new WringerError('environment', { message: 'The guide reads no pull request.' }),
  );
}
