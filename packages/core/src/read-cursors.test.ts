import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { readCursors } from './read-cursors.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-cursors');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { streams: join(directory, 'streams') };
}

test('it reads each stream file size as its cursor', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.streams);
  await writeFile(join(ctx.streams, 'orders.ndjson'), '{"line":"paid"}\n');
  await writeFile(join(ctx.streams, 'notes.txt'), 'kale\n');

  const cursors = await readCursors(ctx.streams);

  expect(cursors).toStrictEqual({ orders: 16 });
});

test('it reads no cursors before any stream started', async () => {
  const ctx = await setupTest();
  const cursors = await readCursors(ctx.streams);

  expect(cursors).toStrictEqual({});
});

test('it rejects a streams path that is a file', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.streams, 'kale\n');

  expect(readCursors(ctx.streams)).rejects.toMatchObject({ code: 'ENOTDIR' });
});
