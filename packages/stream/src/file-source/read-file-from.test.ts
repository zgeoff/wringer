import { expect, test } from 'bun:test';
import { open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { readFileFrom } from './read-file-from.ts';
import type { FilePosition } from './read-file-from.ts';

function setupTest() {
  const directory = createTempDir('read-file-from').path;
  const logPath = join(directory, 'app.log');

  return {
    directory,
    logPath,
    readFrom: (from: FilePosition, limitBytes: number) =>
      readFileFrom(logPath, from, limitBytes, (path) => open(path, 'r')),
  };
}

test('it reads a file from the offset to its end', async () => {
  const ctx = setupTest();

  await writeFile(ctx.logPath, 'booted\nready\n');

  const chunk = await ctx.readFrom({ offset: 7, identity: null }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 7,
    text: 'ready\n',
  });
});

test('it reads a file that does not exist yet as empty', async () => {
  const ctx = setupTest();

  const chunk = await ctx.readFrom({ offset: 0, identity: null }, 1024);

  expect(chunk).toStrictEqual({ start: 0, identity: null, bytes: new Uint8Array() });
});

test('it reads a file that shrank below the offset from its start', async () => {
  const ctx = setupTest();

  await writeFile(ctx.logPath, 'new\n');

  const chunk = await ctx.readFrom({ offset: 40, identity: null }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 0,
    text: 'new\n',
  });
});

test('it reads a longer file that replaced the one it read from its start', async () => {
  const ctx = setupTest();
  const replacement = join(ctx.directory, 'app.log.new');

  await writeFile(ctx.logPath, 'booted\n');

  const first = await ctx.readFrom({ offset: 0, identity: null }, 1024);

  await writeFile(replacement, 'rotated and serving\n');
  await rename(replacement, ctx.logPath);

  const chunk = await ctx.readFrom({ offset: 7, identity: first.identity }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 0,
    text: 'rotated and serving\n',
  });
});

test('it reads at most the limit from the offset', async () => {
  const ctx = setupTest();

  await writeFile(ctx.logPath, 'booted\nready\nserving\n');

  const chunk = await ctx.readFrom({ offset: 7, identity: null }, 5);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 7,
    text: 'ready',
  });
});
