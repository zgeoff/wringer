import { expect, onTestFinished, test } from 'bun:test';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { readFileFrom } from './read-file-from.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-file-from');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, logPath: join(directory, 'app.log') };
}

test('it reads a file from the offset to its end', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, 'booted\nready\n');

  const chunk = await readFileFrom(ctx.logPath, { offset: 7, identity: null }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 7,
    text: 'ready\n',
  });
});

test('it reads a file that does not exist yet as empty', async () => {
  const ctx = await setupTest();
  const chunk = await readFileFrom(ctx.logPath, { offset: 0, identity: null }, 1024);

  expect(chunk).toStrictEqual({ start: 0, identity: null, bytes: new Uint8Array() });
});

test('it reads a file that shrank below the offset from its start', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, 'new\n');

  const chunk = await readFileFrom(ctx.logPath, { offset: 40, identity: null }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 0,
    text: 'new\n',
  });
});

test('it reads a longer file that replaced the one it read from its start', async () => {
  const ctx = await setupTest();

  const replacement = join(ctx.directory, 'app.log.new');

  await writeFile(ctx.logPath, 'booted\n');

  const first = await readFileFrom(ctx.logPath, { offset: 0, identity: null }, 1024);

  await writeFile(replacement, 'rotated and serving\n');
  await rename(replacement, ctx.logPath);

  const chunk = await readFileFrom(ctx.logPath, { offset: 7, identity: first.identity }, 1024);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 0,
    text: 'rotated and serving\n',
  });
});

test('it reads at most the limit from the offset', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, 'booted\nready\nserving\n');

  const chunk = await readFileFrom(ctx.logPath, { offset: 7, identity: null }, 5);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 7,
    text: 'ready',
  });
});
