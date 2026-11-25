import { expect, test } from 'bun:test';
import { realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { inspectFile } from './inspect-file.ts';

function setupTest() {
  const root = createTempDir('inspect-file').path;

  return { root };
}

test('it reads a regular file as regular, at its own real path', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.root, 'note.txt'), 'x');

  const facts = await inspectFile(join(ctx.root, 'note.txt'));
  const expectedPath = await realpath(join(ctx.root, 'note.txt'));

  expect(facts).toStrictEqual({ realPath: expectedPath, isRegularFile: true });
});

test('it reads a symlink as not regular, at its target', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.root, 'note.txt'), 'x');
  await symlink(join(ctx.root, 'note.txt'), join(ctx.root, 'link.txt'));

  const facts = await inspectFile(join(ctx.root, 'link.txt'));
  const expectedPath = await realpath(join(ctx.root, 'note.txt'));

  expect(facts).toStrictEqual({ realPath: expectedPath, isRegularFile: false });
});

test('it reads a missing path as null', async () => {
  const ctx = setupTest();

  const facts = await inspectFile(join(ctx.root, 'gone.txt'));

  expect(facts).toBeNull();
});
