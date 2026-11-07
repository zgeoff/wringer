import { expect, test } from 'bun:test';
import { buildSkipWorktreeMarks } from './build-skip-worktree-marks.ts';

test.each([
  { name: 'no entries', taggedEntries: Buffer.from('') },
  { name: 'only cached entries', taggedEntries: Buffer.from('H src/app.ts\0H README.md\0') },
  { name: 'a path that starts with S', taggedEntries: Buffer.from('H S notes.md\0') },
])('it plans no mark for $name', (row) => {
  const requests = buildSkipWorktreeMarks({
    root: '/srv/repo',
    env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    taggedEntries: row.taggedEntries,
  });

  expect(requests).toStrictEqual([]);
});

test.each([
  {
    name: 'one skip-worktree entry',
    taggedEntries: [Buffer.from('H src/app.ts\0S docs/guide.md\0')],
    paths: [Buffer.from('docs/guide.md\0')],
  },
  {
    name: 'two skip-worktree entries',
    taggedEntries: [Buffer.from('S docs/a.md\0H src/app.ts\0S docs/b.md\0')],
    paths: [Buffer.from('docs/a.md\0docs/b.md\0')],
  },
  {
    name: 'a skip-worktree path that holds a space',
    taggedEntries: [Buffer.from('S docs/user guide.md\0')],
    paths: [Buffer.from('docs/user guide.md\0')],
  },
  {
    name: 'a skip-worktree path that is not UTF-8',
    taggedEntries: [Buffer.from('S docs/caf'), Buffer.from([0xe9, 0])],
    paths: [Buffer.from('docs/caf'), Buffer.from([0xe9, 0])],
  },
])('it plans one skip-worktree mark from the root for $name', (row) => {
  const requests = buildSkipWorktreeMarks({
    root: '/srv/repo',
    env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    taggedEntries: Buffer.concat(row.taggedEntries),
  });

  expect(requests).toStrictEqual([
    {
      cwd: '/srv/repo',
      args: ['update-index', '-z', '--skip-worktree', '--stdin'],
      stdin: Buffer.concat(row.paths),
      env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    },
  ]);
});
