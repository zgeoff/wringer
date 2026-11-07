import { expect, test } from 'bun:test';
import { buildSubmoduleAdds } from './build-submodule-adds.ts';

test.each([
  { name: 'no entries', stagedEntries: [], paths: [] },
  {
    name: 'only file entries',
    stagedEntries: [
      Buffer.from('100644 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tsrc/app.ts\u0000'),
    ],
    paths: [],
  },
  {
    name: 'a submodule among files',
    stagedEntries: [
      Buffer.from(
        '100644 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tsrc/app.ts\u0000160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tvendor/lib\u0000',
      ),
    ],
    paths: [Buffer.from('vendor/lib\u0000')],
  },
  {
    name: 'a submodule whose path holds a tab',
    stagedEntries: [
      Buffer.from('160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tvendor/odd\tname\u0000'),
    ],
    paths: [Buffer.from('vendor/odd\tname\u0000')],
  },
  {
    name: 'a submodule whose path is not UTF-8',
    stagedEntries: [
      Buffer.from('160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tvendor/caf'),
      Buffer.from([0xe9, 0]),
    ],
    paths: [Buffer.concat([Buffer.from('vendor/caf'), Buffer.from([0xe9, 0])])],
  },
  {
    name: 'two submodules',
    stagedEntries: [
      Buffer.from(
        '160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tlib/a\u0000160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tlib/b\u0000',
      ),
    ],
    paths: [Buffer.from('lib/a\u0000lib/b\u0000')],
  },
])('it plans one literal force-add from the root for $name', (row) => {
  const requests = buildSubmoduleAdds({
    root: '/srv/repo',
    env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    stagedEntries: Buffer.concat(row.stagedEntries),
  });

  expect(requests).toStrictEqual(
    row.paths.map((stdin) => ({
      cwd: '/srv/repo',
      args: ['add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'],
      env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index', GIT_LITERAL_PATHSPECS: '1' },
      stdin,
    })),
  );
});
