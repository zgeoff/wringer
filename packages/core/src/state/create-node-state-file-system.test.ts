import { expect, test } from 'bun:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';

function setupTest() {
  const directory = createTempDir('node-state-file-system').path;

  return { directory, fs: createNodeStateFileSystem() };
}

test('#readText reads a missing file as null', async () => {
  const ctx = setupTest();

  const text = await ctx.fs.readText(join(ctx.directory, 'notes.txt'));

  expect(text).toBeNull();
});

test('#readText rejects a path that is a folder', async () => {
  const ctx = setupTest();

  await mkdir(join(ctx.directory, 'notes.txt'));

  expect(ctx.fs.readText(join(ctx.directory, 'notes.txt'))).rejects.toMatchObject({
    code: 'EISDIR',
  });
});

test('#listNames lists a missing folder as empty', async () => {
  const ctx = setupTest();

  const names = await ctx.fs.listNames(join(ctx.directory, 'beds'));

  expect(names).toStrictEqual([]);
});

test('#listNames rejects a path that is a file', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'beds'), 'kale\n');

  expect(ctx.fs.listNames(join(ctx.directory, 'beds'))).rejects.toMatchObject({
    code: 'ENOTDIR',
  });
});

test('#appendText adds the text after what the file holds', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'kale\n');

  await ctx.fs.appendText(join(ctx.directory, 'notes.txt'), 'leeks\n');

  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect(text).toBe('kale\nleeks\n');
});

test('#appendText writes every byte of a long text with multi-byte letters', async () => {
  const ctx = setupTest();
  const long = 'Grüße an die Beete\n'.repeat(400_000);

  await ctx.fs.appendText(join(ctx.directory, 'notes.txt'), long);

  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect(text === long).toBeTrue();
});

test('#readFileSize reads the size of a file in bytes', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'kale\n');

  const size = await ctx.fs.readFileSize(join(ctx.directory, 'notes.txt'));

  expect(size).toBe(5);
});

test('#truncateFile keeps the first bytes of the file', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'kale\nlee');

  await ctx.fs.truncateFile(join(ctx.directory, 'notes.txt'), 5);

  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect(text).toBe('kale\n');
});

test('#writeTextAtomic replaces the file and leaves no temp file', async () => {
  const ctx = setupTest();

  await writeFile(join(ctx.directory, 'notes.txt'), 'kale\n');

  await ctx.fs.writeTextAtomic(join(ctx.directory, 'notes.txt'), 'leeks\n');

  expect({
    text: await readFile(join(ctx.directory, 'notes.txt'), 'utf8'),
    names: await readdir(ctx.directory),
  }).toStrictEqual({ text: 'leeks\n', names: ['notes.txt'] });
});

test('#writeTextAtomic completes every write when many run at once', async () => {
  const ctx = setupTest();
  const texts = Array.from({ length: 20 }, (_, index) => `note ${index}\n`);

  await Promise.all(
    texts.map((text) => ctx.fs.writeTextAtomic(join(ctx.directory, 'notes.txt'), text)),
  );

  const names = await readdir(ctx.directory);
  const text = await readFile(join(ctx.directory, 'notes.txt'), 'utf8');

  expect({ names, isOneOfTheWrites: texts.includes(text) }).toStrictEqual({
    names: ['notes.txt'],
    isOneOfTheWrites: true,
  });
});

test('#createDirectory creates the folder and its parents', async () => {
  const ctx = setupTest();

  await ctx.fs.createDirectory(join(ctx.directory, 'garden/beds'));

  const names = await readdir(join(ctx.directory, 'garden'));

  expect(names).toStrictEqual(['beds']);
});
