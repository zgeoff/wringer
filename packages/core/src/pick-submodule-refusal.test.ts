import { expect, test } from 'bun:test';
import { pickSubmoduleRefusal } from './pick-submodule-refusal.ts';

test.each([
  { name: 'no entries', status: '' },
  {
    name: 'a changed file',
    status: `1 .M N... 100644 100644 100644 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 app.ts\0`,
  },
  {
    name: 'a submodule whose commit moved',
    status: `1 .M SC.. 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 lib\0`,
  },
  {
    name: 'a renamed file whose old path reads like a dirty submodule',
    status: `2 R. N... 100644 100644 100644 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 R100 new.ts\u00001 .M S.M. old\0`,
  },
])('it refuses nothing for $name', (row) => {
  expect(pickSubmoduleRefusal(Buffer.from(row.status), [])).toBeNull();
});

test.each([
  { name: 'tracked edits', sub: 'S.M.', path: 'lib' },
  { name: 'untracked files', sub: 'S..U', path: 'lib' },
  { name: 'a moved commit and edits', sub: 'SCM.', path: 'lib' },
  { name: 'edits, at a path with a space', sub: 'S.M.', path: 'vendor/price list' },
])('it refuses a submodule with $name', (row) => {
  const status = `1 .M ${row.sub} 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 ${row.path}\0`;

  expect(pickSubmoduleRefusal(Buffer.from(status), [])).toMatchObject({
    code: 'environment',
    message: `The submodule ${row.path} holds work that is not committed in it, so the change has no fingerprint.`,
  });
});

test('it names every dirty submodule', () => {
  const status = [
    `1 .M S.M. 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 lib`,
    `1 .M N... 100644 100644 100644 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 app.ts`,
    `1 .M S..U 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 vendor`,
    '',
  ].join('\0');

  expect(pickSubmoduleRefusal(Buffer.from(status), [])).toMatchObject({
    message:
      'The submodule lib, vendor holds work that is not committed in it, so the change has no fingerprint.',
  });
});

test.each([
  { name: 'its exact path', path: 'lib', ignore: ['lib'] },
  { name: 'a glob over its folder', path: 'vendor/lib', ignore: ['vendor/**'] },
])('it refuses no dirty submodule that the ignore list covers by $name', (row) => {
  const status = `1 .M S.M. 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 ${row.path}\0`;

  expect(pickSubmoduleRefusal(Buffer.from(status), row.ignore)).toBeNull();
});

test('it still refuses a dirty submodule the ignore list does not cover', () => {
  const status = [
    `1 .M S.M. 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 docs`,
    `1 .M S.M. 160000 160000 160000 48ee17484d28109fff28c5e25cec8e0a0978f815 48ee17484d28109fff28c5e25cec8e0a0978f815 lib`,
    '',
  ].join('\0');

  expect(pickSubmoduleRefusal(Buffer.from(status), ['docs'])).toMatchObject({
    message:
      'The submodule lib holds work that is not committed in it, so the change has no fingerprint.',
  });
});
