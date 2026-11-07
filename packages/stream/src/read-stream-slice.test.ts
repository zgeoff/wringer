import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { buildStubClock } from '../../core/test-utils/build-stub-clock.ts';
import { buildStreamSeeder } from '../test-utils/build-stream-seeder.ts';
import { readStreamSlice } from './read-stream-slice.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'stream-slice');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const streams = join(directory, 'streams');
  const path = join(streams, 'app.ndjson');
  const clock = buildStubClock();

  return {
    path,
    clock,
    seed: buildStreamSeeder({ streams, now: clock.now }),
    read: (from: number, maxBytes = 64 * 1024) =>
      readStreamSlice({ path, from, maxBytes }, (file) => open(file, 'r')),
  };
}

test('it reads nothing from a stream that has no file yet', async () => {
  const ctx = await setupTest();
  const slice = await ctx.read(0);

  expect(slice).toStrictEqual({ records: [], cursor: 0, more: false });
});

test('it rejects a stream path that is a folder with an environment error', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.path, { recursive: true });

  expect(ctx.read(0)).rejects.toMatchObject({ code: 'environment' });
});

test('it reads every record and returns the end of the file as the cursor', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  await ctx.seed.stream('app', ['booted', 'order 7 placed']);

  const slice = await ctx.read(0);

  expect(slice).toStrictEqual({
    records: [
      { at: '2026-03-01T09:30:00.000Z', line: 'booted' },
      { at: '2026-03-01T09:30:00.000Z', line: 'order 7 placed' },
    ],
    cursor: Bun.file(ctx.path).size,
    more: false,
  });
});

test('it stops at the last whole record within maxBytes and says there is more', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  await ctx.seed.stream('app', ['booted', 'order 7 placed']);

  const firstLength = `${JSON.stringify({ at: '2026-03-01T09:30:00.000Z', line: 'booted' })}\n`
    .length;

  const slice = await ctx.read(0, firstLength + 5);

  expect(slice).toStrictEqual({
    records: [{ at: '2026-03-01T09:30:00.000Z', line: 'booted' }],
    cursor: firstLength,
    more: true,
  });
});

test('it starts at the next record when the cursor lands inside one', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  await ctx.seed.stream('app', ['booted', 'order 7 placed']);

  const slice = await ctx.read(3);

  expect(slice.records).toStrictEqual([{ at: '2026-03-01T09:30:00.000Z', line: 'order 7 placed' }]);
});

test('it starts over at 0 when the cursor is past the end of the file', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  await ctx.seed.stream('app', ['booted']);

  const slice = await ctx.read(10_000);

  expect(slice.records).toStrictEqual([{ at: '2026-03-01T09:30:00.000Z', line: 'booted' }]);
});
