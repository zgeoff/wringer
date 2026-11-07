import { expect, test } from 'bun:test';
import { pickMergeBaseSteps } from './pick-merge-base-steps.ts';
import { WringerError } from './wringer-error.ts';

test.each([
  { name: 'no output', newestCommit: '' },
  { name: 'only a line end', newestCommit: '\n' },
])('it returns an environment error for a repo with no commit, given $name', (row) => {
  const steps = pickMergeBaseSteps({
    root: '/srv/repo',
    base: 'main',
    newestCommit: row.newestCommit,
  });

  expect(steps).toMatchObject({
    code: 'environment',
    message: 'The repo has no commit yet, so its change has no fingerprint.',
  });
});

test('it plans a check of the base, then the merge base, from the root', () => {
  const steps = pickMergeBaseSteps({
    root: '/srv/repo',
    base: 'origin/release',
    newestCommit: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad\n',
  });

  expect(steps).toStrictEqual({
    verifyBase: { cwd: '/srv/repo', args: ['rev-parse', '--verify', 'origin/release^{commit}'] },
    mergeBase: { cwd: '/srv/repo', args: ['merge-base', 'HEAD', 'origin/release'] },
    noSharedCommit: expect.any(WringerError),
  });
});

test('it names the base in the error for a base that shares no commit with HEAD', () => {
  const steps = pickMergeBaseSteps({
    root: '/srv/repo',
    base: 'origin/release',
    newestCommit: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad\n',
  });

  expect(steps).toMatchObject({
    noSharedCommit: {
      code: 'environment',
      message:
        'HEAD and origin/release share no commit in this clone, so the change has no fingerprint.',
    },
  });
});
