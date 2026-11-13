import { expect, test } from 'bun:test';
import { pickPullRequest } from './pick-pull-request.ts';

test.each([
  {
    name: 'no PR',
    found: { kind: 'none' },
    byNumber: false,
    message: 'The current branch has no open pull request.',
  },
  {
    name: 'several PRs',
    found: { kind: 'many', numbers: [3, 5] },
    byNumber: false,
    message: 'The current branch has several open pull requests: 3, 5.',
  },
  {
    name: 'a closed PR named by number',
    found: {
      kind: 'one',
      pr: {
        number: 7,
        url: 'https://github.example/pull/7',
        body: '',
        baseBranch: 'main',
        state: 'closed',
      },
    },
    byNumber: true,
    message: 'Pull request 7 is closed.',
  },
  {
    name: 'a merged PR named by number',
    found: {
      kind: 'one',
      pr: {
        number: 7,
        url: 'https://github.example/pull/7',
        body: '',
        baseBranch: 'main',
        state: 'merged',
      },
    },
    byNumber: true,
    message: 'Pull request 7 is merged.',
  },
] as const)('it fails with environment for $name', (row) => {
  const result = pickPullRequest(row.found, row.byNumber);
  const failure = result.ok ? null : result.failure;

  expect({ code: failure?.code, message: failure?.message }).toStrictEqual({
    code: 'environment',
    message: row.message,
  });
});

test('it picks the one open PR', () => {
  const pr = {
    number: 7,
    url: 'https://github.example/pull/7',
    body: '',
    baseBranch: 'main',
    state: 'open',
  } as const;

  expect(pickPullRequest({ kind: 'one', pr }, true)).toStrictEqual({ ok: true, pr });
});
