import { expect, test } from 'bun:test';
import { buildSubmoduleAdds } from './build-submodule-adds.ts';

test.each([
  { name: 'no entries', stagedEntries: '', paths: [] },
  {
    name: 'only file entries',
    stagedEntries: '100644 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tsrc/app.ts\u0000',
    paths: [],
  },
  {
    name: 'a submodule among files',
    stagedEntries:
      '100644 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tsrc/app.ts\u0000160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tvendor/lib\u0000',
    paths: [[':(top,literal)vendor/lib']],
  },
  {
    name: 'a submodule whose path holds a tab',
    stagedEntries: '160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tvendor/odd\tname\u0000',
    paths: [[':(top,literal)vendor/odd\tname']],
  },
  {
    name: 'two submodules',
    stagedEntries:
      '160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tlib/a\u0000160000 3b18e512dba79e4c8300dd08aeb37f8e728b8dad 0\tlib/b\u0000',
    paths: [[':(top,literal)lib/a', ':(top,literal)lib/b']],
  },
] as const)('it plans one force-add per call for $name', (row) => {
  const requests = buildSubmoduleAdds({
    cwd: '/srv/repo',
    env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    stagedEntries: row.stagedEntries,
  });

  expect(requests).toStrictEqual(
    row.paths.map((paths) => ({
      cwd: '/srv/repo',
      args: ['add', '--force', '--', ...paths],
      env: { GIT_INDEX_FILE: '/srv/repo/.git/wringer-index' },
    })),
  );
});
