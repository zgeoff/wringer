import { expect, mock, onTestFinished, test } from 'bun:test';
import { appendFile, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDirectory, local } from '@wringer/core';
import { buildStubClock } from '@wringer/core/test-utils/build-stub-clock.ts';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { readOptionalText } from '@zgeoff/std';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { appendWholeText } from './append-whole-text.ts';
import { readFileFrom } from './read-file-from.ts';
import type { FilePosition } from './read-file-from.ts';
import { buildSourceStatus, startStreamRecorder } from './start-stream-recorder.ts';
import type { StreamSource } from './start-stream-recorder.ts';
import { waitOrAbort } from './wait-or-abort.ts';

// The recorder writes into the test folder until it stops, so the stack stops every recorder
// before it removes the folder.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await createTestFolder(import.meta.dir, 'stream-recorder');

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const streams = join(directory, 'streams');
  const createDirectoryCalls = mock(createDirectory);

  const readFileCalls = mock((path: string, from: FilePosition, limitBytes: number) =>
    readFileFrom(path, from, limitBytes, (file) => open(file, 'r')),
  );

  const clock = buildStubClock();

  return {
    directory,
    streams,
    clock,
    createDirectoryCalls,

    readLargestFileRead: async () => {
      const chunks = await Promise.all(
        readFileCalls.mock.results.flatMap((result) =>
          result.type === 'return' ? [result.value] : [],
        ),
      );

      return Math.max(...chunks.map((chunk) => chunk.bytes.length));
    },

    // The next file read returns only its first bytes, as a read of a file that changed under it
    // can.
    shortenNextRead: (byteCount: number) => {
      readFileCalls.mockImplementationOnce(async (path, from, limitBytes) => {
        const chunk = await readFileFrom(path, from, limitBytes, (file) => open(file, 'r'));

        return { ...chunk, bytes: chunk.bytes.subarray(0, byteCount) };
      });
    },

    // Every file read returns one more line, as a file whose writer never stops would.
    feedEndlessFile: () => {
      readFileCalls.mockImplementation((_path, from) =>
        Promise.resolve({
          start: from.offset,
          identity: '1:7',
          bytes: new TextEncoder().encode('tick\n'),
        }),
      );
    },

    // Resolves once the recorder has finished its first read of a file source.
    firstFileRead: async () => {
      await waitFor(() => {
        invariant(readFileCalls.mock.results[0], 'The recorder has not read the file yet.');
      });

      await readFileCalls.mock.results[0]?.value;
    },
    streamPath: (name: string) => join(streams, `${name}.ndjson`),
    start: async (sources: Readonly<Record<string, StreamSource>>, pendingLimit = 10_000) => {
      const recorder = await startStreamRecorder({
        sources,
        directory: streams,
        host: local(),
        access: 'read-only',
        now: clock.now,
        createDirectory: createDirectoryCalls,
        appendText: appendWholeText,
        readFileFrom: readFileCalls,
        wait: waitOrAbort,
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
      const text = await readOptionalText(join(streams, `${name}.ndjson`));

      return text ?? '';
    },
  };
}

test('it creates its folder through the folder creator it is given', async () => {
  const ctx = await setupTest();

  await ctx.start({});

  expect(ctx.createDirectoryCalls).toHaveBeenCalledExactlyOnceWith(ctx.streams);
});

test('it records the lines a command source printed as the recorder stopped', async () => {
  const ctx = await setupTest();

  const gate = join(ctx.directory, 'gate');

  const recorder = await ctx.start({
    app: {
      command: [
        'sh',
        '-c',
        'echo ready; while [ ! -e "$0" ]; do sleep 0.01; done; seq 1 3000; exec sleep 30',
        gate,
      ],
    },
  });

  await waitFor(async () => {
    const recorded = await ctx.readStream('app');

    invariant(recorded.includes('"ready"'), 'The command has not printed its first line yet.');
  });

  await writeFile(gate, '');

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded.split('\n').at(-2)).toInclude('"line":"3000"');
});

test('it records each line of a command source with the time it arrived', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'booted', 'ready'] } });

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'exited', 'The source has not exited yet.');
  });

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n{"at":"2026-03-01T09:30:00.000Z","line":"ready"}\n',
  );
});

test('it records the lines appended to a file source', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, 'booted\n');

  await ctx.start({ app: { file: log } });

  await appendFile(log, 'order 7 placed\n');

  const recorded = await waitFor(async () => {
    const text = await ctx.readStream('app');

    invariant(text.includes('order 7 placed'), 'The stream has not recorded order 7 yet.');

    return text;
  });

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n{"at":"2026-03-01T09:30:00.000Z","line":"order 7 placed"}\n',
  );
});

test('it records the lines a file source gained just before the recorder stopped', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

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

test('it records the rest of a file source after a read that stopped short of its end', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const log = join(ctx.directory, 'app.log');

  await writeFile(log, '');

  const recorder = await ctx.start({ app: { file: log } });

  await ctx.firstFileRead();

  await appendFile(log, 'first\nlast\n');

  ctx.shortenNextRead(6);

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe(
    '{"at":"2026-03-01T09:30:00.000Z","line":"first"}\n{"at":"2026-03-01T09:30:00.000Z","line":"last"}\n',
  );
});

test('it ends its stop when a file source never reaches its end', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  ctx.feedEndlessFile();

  const recorder = await ctx.start({ app: { file: log } });

  expect(recorder.stop()).resolves.toBeUndefined();
});

test('it records a longer file that replaced a file source from its start, without the old unfinished line', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

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

  ctx.clock.set('2026-03-01T09:30:00.000Z');

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

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'x'.repeat(10_000)] } });

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'exited', 'The source has not exited yet.');
  });

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

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'exited', 'The source has not exited yet.');
  });

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

    invariant(settled.length === 2, 'Both sources have not settled yet.');

    return current;
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

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'failed', 'The source has not failed yet.');
  });

  expect(recorder.stop()).rejects.toMatchObject({ code: 'environment' });
});

test('it fails its stop with an environment error when a file source cannot be read', async () => {
  const ctx = await setupTest();

  const log = join(ctx.directory, 'app.log');

  await mkdir(log);

  const recorder = await ctx.start({ app: { file: log } });

  expect(recorder.stop()).rejects.toMatchObject({ code: 'environment' });
});

test('it keeps a batch that failed to write and writes it once the disk recovers', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  await mkdir(ctx.streamPath('app'), { recursive: true });

  const recorder = await ctx.start({ app: { command: ['printf', '%s\n', 'booted'] } });

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'failed', 'The source has not failed yet.');
  });

  await rm(ctx.streamPath('app'), { recursive: true });

  await recorder.stop();

  const recorded = await ctx.readStream('app');

  expect(recorded).toBe('{"at":"2026-03-01T09:30:00.000Z","line":"booted"}\n');
});

test('it reports a source as running again once a write succeeds after one that failed', async () => {
  const ctx = await setupTest();

  await mkdir(ctx.streamPath('app'), { recursive: true });

  const recorder = await ctx.start({
    app: { command: ['sh', '-c', 'while true; do echo tick; sleep 0.1; done'] },
  });

  await waitFor(() => {
    invariant(recorder.status()[0]?.state === 'failed', 'The source has not failed yet.');
  });

  await rm(ctx.streamPath('app'), { recursive: true });

  const status = await waitFor(() => {
    const [current] = recorder.status();

    invariant(current?.state === 'running', 'The source is not running again yet.');

    return current;
  });

  expect(status).toStrictEqual({ name: 'app', state: 'running', detail: null });
});

test.each([
  { phase: 'running', status: { name: 'app', state: 'running', detail: null } },
  { phase: 'exited', status: { name: 'app', state: 'exited', detail: 'exit code 0' } },
  { phase: 'failed', status: { name: 'app', state: 'failed', detail: 'exit code 0' } },
  {
    phase: 'exited-unwritten',
    status: { name: 'app', state: 'failed', detail: 'The disk is full.' },
  },
] as const)('#buildSourceStatus reports the $phase phase as $status.state', (row) => {
  expect(
    buildSourceStatus('app', row.phase, { reading: 'exit code 0', write: 'The disk is full.' }),
  ).toStrictEqual(row.status);
});
