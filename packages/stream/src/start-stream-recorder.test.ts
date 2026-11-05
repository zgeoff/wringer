import { expect, mock, onTestFinished, test } from 'bun:test';
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDirectory, local } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { appendWholeText } from './append-whole-text.ts';
import { readFileFrom } from './read-file-from.ts';
import { canMoveSource, startStreamRecorder } from './start-stream-recorder.ts';
import type { StreamSource } from './start-stream-recorder.ts';

// The recorder writes into the test folder until it stops, so the stack stops every recorder
// before it removes the folder.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'stream-recorder');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const streams = join(directory, 'streams');
  const createDirectoryCalls = mock(createDirectory);
  const readFileCalls = mock(readFileFrom);

  return {
    directory,
    streams,
    createDirectoryCalls,

    readLargestFileRead: async () => {
      const chunks = await Promise.all(
        readFileCalls.mock.results.flatMap((result) =>
          result.type === 'return' ? [result.value] : [],
        ),
      );

      return Math.max(...chunks.map((chunk) => chunk.bytes.length));
    },

    // Resolves once the recorder has finished its first read of a file source.
    firstFileRead: async () => {
      await waitFor(() => readFileCalls.mock.results[0] ?? null);
      await readFileCalls.mock.results[0]?.value;
    },
    streamPath: (name: string) => join(streams, `${name}.ndjson`),
    start: async (sources: Readonly<Record<string, StreamSource>>, pendingLimit = 10_000) => {
      const recorder = await startStreamRecorder({
        sources,
        directory: streams,
        host: local(),
        access: 'read-only',
        now: () => new Date('2026-03-01T09:30:00.000Z'),
        createDirectory: createDirectoryCalls,
        appendText: appendWholeText,
        readFileFrom: readFileCalls,
        pendingLimit,
      });

      stack.defer(async () => {
        await recorder.stop().catch(() => {
          // A test that stops the recorder itself asserts how the stop went.
        });
      });

      return recorder;
    },
    readStream: async (name: string) => {
      const file = Bun.file(join(streams, `${name}.ndjson`));

      const exists = await file.exists();

      return exists ? file.text() : '';
    },
  };
}

test('it creates its folder through the folder creator it is given', async () => {
  const ctx = await setupTest();

  await ctx.start({});

  expect(ctx.createDirectoryCalls).toHaveBeenCalledExactlyOnceWith(ctx.streams);
});

test('it records each line of a command source with the time it arrived', async () => {
  const ctx = await setupTest();
  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'booted', 'ready'] } });

  await waitFor(() => (recorder.status()[0]?.state === 'exited' ? true : null));

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n{"at":"2026-03-01T09:30:00.000Z","line":"ready"}\n',
  );
});

test('it records the lines appended to a file source', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, 'booted\n');

  await ctx.start({ app: { file: log } });

  await appendFile(log, 'order 7 placed\n');

  const recorded = await waitFor(async () => {
    const text = await ctx.readStream('app');

    return text.includes('order 7 placed') ? text : null;
  });

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n{"at":"2026-03-01T09:30:00.000Z","line":"order 7 placed"}\n',
  );
});

test('it records the lines a file source gained just before the recorder stopped', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, '');

  const recorder = await ctx.start({ app: { file: log } });

  await ctx.firstFileRead();

  await appendFile(log, 'shutting down\nbye');

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"shutting down"}\n{"at":"2026-03-01T09:30:00.000Z","line":"bye"}\n',
  );
});

test('it records a longer file that replaced a file source from its start, without the old unfinished line', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');
  const replacement = join(ctx.directory, 'app.log.new');

  // The old file ends inside the two bytes of `é`.
  await writeFile(log, new Uint8Array([...new TextEncoder().encode('booted\nhalf a caf'), 0xc3]));

  const recorder = await ctx.start({ app: { file: log } });

  await ctx.firstFileRead();

  await writeFile(replacement, 'rotated, and now serving orders\n');
  await rename(replacement, log);

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n{"at":"2026-03-01T09:30:00.000Z","line":"rotated, and now serving orders"}\n',
  );
});

test('it records a file source that held a large log before the start in reads of 64 KiB at most', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, 'order placed for the spring catalogue\n'.repeat(5000));

  const recorder = await ctx.start({ app: { file: log } });

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect({
    lines: recorded.split('\n').length - 1,
    largestReadBytes: await ctx.readLargestFileRead(),
  }).toStrictEqual({ lines: 5000, largestReadBytes: 64 * 1024 });
});

test('it caps a file source line that arrives over several reads at 4096 characters', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, 'x'.repeat(6000));

  const recorder = await ctx.start({ app: { file: log } });

  await ctx.firstFileRead();

  await appendFile(log, `${'x'.repeat(6000)}\n`);

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(`{"at":"2026-03-01T09:30:00.000Z","line":"${'x'.repeat(4096)}..."}\n`);
});

test('it caps a long line at 4096 characters', async () => {
  const ctx = await setupTest();
  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'x'.repeat(10_000)] } });

  await waitFor(() => (recorder.status()[0]?.state === 'exited' ? true : null));

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    `${JSON.stringify({ at: '2026-03-01T09:30:00.000Z', line: `${'x'.repeat(4096)}...` })}\n`,
  );
});

test('it drops the lines past the pending limit and records how many it dropped', async () => {
  const ctx = await setupTest();

  const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', ...lines] } }, 2);

  await waitFor(() => (recorder.status()[0]?.state === 'exited' ? true : null));

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toMatch(
    /"line":"\[wringer\] the recorder dropped \d+ lines while it caught up"/u,
  );
});

test('it reports a running source, an exited source and a failed source', async () => {
  const ctx = await setupTest();

  const recorder = await ctx.start({
    tail: { command: ['sleep', '60'] },
    done: { command: ['sh', '-c', 'exit 4'] },
    missing: { command: ['wringer-no-such-command'] },
  });

  const statuses = await waitFor(() => {
    const current = recorder.status();
    const settled = current.filter((status) => status.state !== 'running');

    return settled.length === 2 ? current : null;
  });

  expect(statuses).toStrictEqual([
    { name: 'tail', state: 'running', detail: null },
    { name: 'done', state: 'exited', detail: 'exit code 4' },
    {
      name: 'missing',
      state: 'failed',
      detail: expect.stringContaining('wringer-no-such-command'),
    },
  ]);
});

test('it fails its stop with an environment error when records never reach the disk', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.streamPath('app'), { recursive: true });

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'booted'] } });

  await waitFor(() => (recorder.status()[0]?.state === 'failed' ? true : null));

  expect(recorder.stop()).rejects.toMatchObject({ code: 'environment' });
});

test('it keeps a batch that failed to write and writes it once the disk recovers', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.streamPath('app'), { recursive: true });

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'booted'] } });

  await waitFor(() => (recorder.status()[0]?.state === 'failed' ? true : null));
  await rm(ctx.streamPath('app'), { recursive: true });

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe('{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n');
});

test.each([
  { from: 'running', to: 'exited', allowed: true },
  { from: 'running', to: 'failed', allowed: true },
  { from: 'exited', to: 'failed', allowed: true },
  { from: 'exited', to: 'running', allowed: false },
  { from: 'failed', to: 'exited', allowed: false },
  { from: 'failed', to: 'running', allowed: false },
] as const)('#canMoveSource answers $allowed for $from to $to', (row) => {
  expect(canMoveSource(row.from, row.to)).toBe(row.allowed);
});
