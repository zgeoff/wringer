import { expect, test } from 'bun:test';
import { WringerError } from '../wringer-error.ts';
import { pickMergeBaseFailure } from './pick-merge-base-failure.ts';

test('it picks the no-shared-commit error for a merge-base that exits 1 with nothing on stderr', () => {
  const noSharedCommit = new WringerError('environment', { message: 'No shared commit.' });

  const failure = new WringerError('environment', {
    message: 'git merge-base failed: ',
    data: { exitCode: 1, stderr: '' },
  });

  expect(pickMergeBaseFailure(failure, noSharedCommit)).toBe(noSharedCommit);
});

test.each([
  {
    name: 'exits 1 with a read error',
    data: { exitCode: 1, stderr: 'error: Could not read 3b18e5\n' },
  },
  { name: 'exits 128', data: { exitCode: 128, stderr: 'fatal: bad object HEAD\n' } },
  { name: 'exits 128 with nothing on stderr', data: { exitCode: 128, stderr: '' } },
  { name: 'carries no exit status', data: undefined },
])('it keeps the git failure for a merge-base that $name', (row) => {
  const noSharedCommit = new WringerError('environment', { message: 'No shared commit.' });

  const failure = new WringerError('environment', {
    message: 'git merge-base failed',
    data: row.data,
  });

  expect(pickMergeBaseFailure(failure, noSharedCommit)).toBe(failure);
});

test('it keeps a failure that is not a git failure', () => {
  const noSharedCommit = new WringerError('environment', { message: 'No shared commit.' });
  const failure = new Error('spawn git ENOENT');

  expect(pickMergeBaseFailure(failure, noSharedCommit)).toBe(failure);
});
