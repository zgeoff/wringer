import { expect, test } from 'bun:test';
import { pickTarball } from './pick-tarball.ts';

test('it picks the one tarball among the package files', () => {
  const pick = pickTarball(['package.json', 'acme-kettle-1.2.0.tgz', 'README.md'], '/repo/kettle');

  expect(pick).toStrictEqual({ kind: 'found', tarball: 'acme-kettle-1.2.0.tgz' });
});

test.each([
  [[], 0],
  [['acme-kettle-1.1.0.tgz', 'acme-kettle-1.2.0.tgz'], 2],
])('it refuses the files %p, which hold %p tarballs', (files, count) => {
  const pick = pickTarball(files, '/repo/kettle');

  expect(pick).toStrictEqual({
    kind: 'refused',
    message: `bun pm pack left ${count} tarballs in /repo/kettle`,
  });
});
