import type { PullRequestFound, PullRequestHost, PullRequestView } from '../types.ts';

export interface FakePullRequest extends PullRequestView {
  readonly branch: string;
}

export interface FakePullRequestHost extends PullRequestHost {
  readonly readStoredBody: (number: number) => string | undefined;
}

// An in-memory PR host, for a test of code that reads or writes a description.
export function createFakePullRequestHost(
  pullRequests: readonly FakePullRequest[],
): FakePullRequestHost {
  const stored = new Map(pullRequests.map((pr) => [pr.number, pr]));

  const getPullRequest = (number: number): FakePullRequest => {
    const pr = stored.get(number);

    if (pr === undefined) {
      throw new Error(`The fake host has no pull request ${number}.`);
    }

    return pr;
  };

  return {
    findOpen: (request) => {
      if ('number' in request) {
        return Promise.resolve({ kind: 'one', pr: getPullRequest(request.number) });
      }

      const open = [...stored.values()].filter(
        (pr) => pr.branch === request.branch && pr.state === 'open',
      );

      const [first, ...others] = open;

      if (first === undefined) {
        return Promise.resolve({ kind: 'none' });
      }

      const found: PullRequestFound =
        others.length === 0
          ? { kind: 'one', pr: first }
          : { kind: 'many', numbers: open.map((pr) => pr.number) };

      return Promise.resolve(found);
    },
    readBody: (number) => Promise.resolve(getPullRequest(number)),
    writeBody: (number, body) => {
      stored.set(number, { ...getPullRequest(number), body });

      return Promise.resolve();
    },
    readStoredBody: (number) => stored.get(number)?.body,
  };
}
