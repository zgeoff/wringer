import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeClock } from '@zgeoff/testing/clock';
import { createTempDir } from '@zgeoff/testing/fs';
import { buildStreamSeeder } from './build-stream-seeder.ts';

function setupTest() {
  const directory = createTempDir('stream-seeder').path;
  const streams = join(directory, 'streams');
  const clock = createFakeClock();

  return {
    clock,
    seed: buildStreamSeeder({ streams, now: () => new Date(clock.now()) }),
    readStream: (name: string) => readFile(join(streams, `${name}.ndjson`), 'utf8'),
  };
}

test('it records each line into the stream file with the time the clock reads', async () => {
  const ctx = setupTest();

  ctx.clock.advance(Date.parse('2026-05-20T16:45:00.000Z'));

  await ctx.seed.stream('worker', ['job 12 queued', 'job 12 done']);

  const recorded = await ctx.readStream('worker');

  expect(recorded).toBe(
    '{"at":"2026-05-20T16:45:00.000Z","line":"job 12 queued"}\n{"at":"2026-05-20T16:45:00.000Z","line":"job 12 done"}\n',
  );
});
