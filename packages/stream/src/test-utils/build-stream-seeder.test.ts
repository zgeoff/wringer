import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStubClock } from '@wringer/core/test-utils/build-stub-clock.ts';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { buildStreamSeeder } from './build-stream-seeder.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'stream-seeder');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const streams = join(directory, 'streams');
  const clock = buildStubClock();

  return {
    clock,
    seed: buildStreamSeeder({ streams, now: clock.now }),
    readStream: (name: string) => readFile(join(streams, `${name}.ndjson`), 'utf8'),
  };
}

test('it records each line into the stream file with the time the clock reads', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-05-20T16:45:00.000Z');

  await ctx.seed.stream('worker', ['job 12 queued', 'job 12 done']);

  const recorded = await ctx.readStream('worker');

  expect(recorded).toBe(
    '{"at":"2026-05-20T16:45:00.000Z","line":"job 12 queued"}\n{"at":"2026-05-20T16:45:00.000Z","line":"job 12 done"}\n',
  );
});
