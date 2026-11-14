import { expect, onTestFinished, test } from 'bun:test';
import { realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { inspectFile } from './inspect-file.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'inspect-file');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return { root };
}

test('it reads a regular file as regular, at its own real path', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'note.txt'), 'x');

  const facts = await inspectFile(join(ctx.root, 'note.txt'));
  const expectedPath = await realpath(join(ctx.root, 'note.txt'));

  expect(facts).toStrictEqual({ realPath: expectedPath, isRegularFile: true });
});

test('it reads a symlink as not regular, at its target', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'note.txt'), 'x');
  await symlink(join(ctx.root, 'note.txt'), join(ctx.root, 'link.txt'));

  const facts = await inspectFile(join(ctx.root, 'link.txt'));
  const expectedPath = await realpath(join(ctx.root, 'note.txt'));

  expect(facts).toStrictEqual({ realPath: expectedPath, isRegularFile: false });
});

test('it reads a missing path as null', async () => {
  const ctx = await setupTest();
  const facts = await inspectFile(join(ctx.root, 'gone.txt'));

  expect(facts).toBeNull();
});
