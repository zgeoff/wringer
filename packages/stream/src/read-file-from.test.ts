import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { readFileFrom } from './read-file-from.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-file-from');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { logPath: join(directory, 'app.log') };
}

test('it reads a file from the offset to its end', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, 'booted\nready\n');

  const chunk = await readFileFrom(ctx.logPath, 7);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 7,
    text: 'ready\n',
  });
});

test('it reads a file that does not exist yet as empty', async () => {
  const ctx = await setupTest();
  const chunk = await readFileFrom(ctx.logPath, 0);

  expect({ start: chunk.start, length: chunk.bytes.length }).toStrictEqual({ start: 0, length: 0 });
});

test('it reads a file that shrank below the offset from its start', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.logPath, 'new\n');

  const chunk = await readFileFrom(ctx.logPath, 40);

  expect({ start: chunk.start, text: new TextDecoder().decode(chunk.bytes) }).toStrictEqual({
    start: 0,
    text: 'new\n',
  });
});
