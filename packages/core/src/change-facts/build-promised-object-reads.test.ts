import { expect, test } from 'bun:test';
import { buildPromisedObjectReads } from './build-promised-object-reads.ts';

test.each([
  { name: 'an empty config', configList: '' },
  { name: 'a plain clone', configList: 'core.bare\nfalse\0remote.origin.url\n/srv/upstream\0' },
  { name: 'a promisor set to false', configList: 'remote.origin.promisor\nfalse\0' },
  { name: 'a promisor set to off', configList: 'remote.origin.promisor\noff\0' },
  { name: 'a promisor key with no remote name', configList: 'remote..promisor\ntrue\0' },
])('it plans no read for $name', (row) => {
  const requests = buildPromisedObjectReads({
    root: '/srv/repo',
    mergeBase: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad',
    configList: row.configList,
  });

  expect(requests).toStrictEqual([]);
});

test.each([
  { name: 'a promisor remote', configList: 'remote.origin.promisor\ntrue\0' },
  { name: 'a promisor written in capitals', configList: 'remote.origin.promisor\nTRUE\0' },
  { name: 'a promisor with no value', configList: 'remote.origin.promisor\0' },
  { name: 'a promisor set to 1', configList: 'remote.mirror.promisor\n1\0' },
  {
    name: 'a promisor remote whose name holds a dot',
    configList: 'remote.up.stream.promisor\nyes\0',
  },
  { name: 'the partial clone extension', configList: 'extensions.partialclone\norigin\0' },
  {
    name: 'a promisor among other keys',
    configList: 'core.bare\nfalse\0remote.origin.url\n/srv/upstream\0remote.origin.promisor\non\0',
  },
])('it plans one diff of the base from the root for $name', (row) => {
  const requests = buildPromisedObjectReads({
    root: '/srv/repo',
    mergeBase: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad',
    configList: row.configList,
  });

  expect(requests).toStrictEqual([
    {
      cwd: '/srv/repo',
      args: [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--no-textconv',
        '--output=/dev/null',
        '3b18e512dba79e4c8300dd08aeb37f8e728b8dad',
      ],
    },
  ]);
});
