import { expect, onTestFinished, test } from 'bun:test';
import { open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRunPaths, dispatch } from '@wringer/core';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { readStreamSlice } from './read-stream-slice.ts';
import { streamSliceSchema } from './stream.ts';
import { createStreamWringer } from './test-utils/create-stream-wringer.ts';

async function setupTest() {
  const triggers = await createTestFolder(import.meta.dir, 'stream-triggers');

  onTestFinished(() => rm(triggers, { recursive: true, force: true }));

  const wringer = createStreamWringer(triggers);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
    placeOrder: () => writeFile(join(triggers, 'order'), ''),

    // A run that ended answers no `stream read`, so its records come from the stream's own file.
    readEndedStream: (runID: string, name: string) =>
      readStreamSlice(
        {
          path: join(buildRunPaths(shop.state.paths.root, runID).streams, `${name}.ndjson`),
          from: 0,
          maxBytes: 64 * 1024,
        },
        (path) => open(path, 'r'),
      ),
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('it reads the lines the launched app logged', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app', from: 0 });

    const slice = streamSliceSchema.parse(result.envelope.data);
    const read = slice.records.map((record) => record.line);

    invariant(read.includes('booted'), 'The stream has no booted line yet.');

    return read;
  });

  expect(lines).toStrictEqual(['{"event":"listening","port":4000}', 'booted']);
});

test('it reads from the cursor that use marked when the read gives no from', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app', from: 0 });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(
      slice.records.some((record) => record.line === 'booted'),
      'The stream has no booted line yet.',
    );
  });

  await ctx.run('local', ['use'], { feature: undefined });
  await ctx.placeOrder();

  const lines = await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(slice.records.length > 0, 'The stream has no record yet.');

    return slice.records.map((record) => record.line);
  });

  expect(lines).toStrictEqual(['order placed']);
});

test('it reads a new run from its start when use marked cursors in an older run', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app', from: 0 });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(
      slice.records.some((record) => record.line === 'booted'),
      'The stream has no booted line yet.',
    );
  });

  await ctx.run('local', ['use'], { feature: undefined });
  await ctx.run('local', ['down']);
  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app' });

    const slice = streamSliceSchema.parse(result.envelope.data);
    const read = slice.records.map((record) => record.line);

    invariant(read.includes('booted'), 'The stream has no booted line yet.');

    return read;
  });

  expect(lines).toStrictEqual(['{"event":"listening","port":4000}', 'booted']);
});

test('it records the lines the launched app logged as it stopped', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app', from: 0 });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(
      slice.records.some((record) => record.line === 'booted'),
      'The stream has no booted line yet.',
    );
  });

  const down = await ctx.run('local', ['down']);
  const slice = await ctx.readEndedStream(down.envelope.instance ?? '', 'app');

  // The shell also logs `Terminated` for the `sleep` the SIGTERM ended.
  expect(slice.records.map((record) => record.line)).toContain('closed');
});

test('it records every line of the burst the launched app logged as it stopped, in order', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app', from: 0 });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(
      slice.records.some((record) => record.line === 'booted'),
      'The stream has no booted line yet.',
    );
  });

  const down = await ctx.run('local', ['down']);
  const slice = await ctx.readEndedStream(down.envelope.instance ?? '', 'app');

  const closing = slice.records
    .map((record) => record.line)
    .filter((line) => line.startsWith('closing ') || line === 'closed');

  expect(closing).toStrictEqual([
    ...Array.from({ length: 500 }, (_, index) => `closing ${index + 1}`),
    'closed',
  ]);
});

test('it records a command source on an attach target', async () => {
  const ctx = await setupTest();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('box', ['stream', 'read'], { name: 'jobs' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(slice.records.length > 0, 'The stream has no record yet.');

    return slice.records.map((record) => record.line);
  });

  expect(lines).toStrictEqual(['job 1 done']);
});

test('it reads a stream named after an inherited key from its start when use marked no cursor', async () => {
  const ctx = await setupTest();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('box', ['stream', 'read'], { name: 'constructor' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(slice.records.length > 0, 'The stream has no record yet.');

    return slice.records.map((record) => record.line);
  });

  expect(lines).toStrictEqual(['shelf built']);
});

test('it rejects a read of a stream the target does not record', async () => {
  const ctx = await setupTest();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const result = await ctx.run('box', ['stream', 'read'], { name: 'app' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: {
      code: 'usage',
      message: 'Target box records no stream named app.',
      hint: 'Read one of: jobs, constructor.',
    },
  });
});

test('it rejects a read whose maxBytes could hold no whole record', async () => {
  const ctx = await setupTest();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const result = await ctx.run('box', ['stream', 'read'], { name: 'jobs', maxBytes: 1 });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it reads at most the configured 64 KiB of whole records when a read asks for more', async () => {
  const ctx = await setupTest();

  await ctx.run('bulk', ['attach']);
  await ctx.run('bulk', ['doctor']);

  await waitFor(async () => {
    const result = await ctx.run('bulk', ['stream', 'read'], { name: 'orders', from: 90_000 });

    const slice = streamSliceSchema.parse(result.envelope.data);

    invariant(
      slice.records.at(-1)?.line.startsWith('order 1000 ') === true,
      'The stream has not recorded the last order yet.',
    );
  });

  const result = await ctx.run('bulk', ['stream', 'read'], {
    name: 'orders',
    from: 0,
    maxBytes: 1024 * 1024,
  });

  const payload: unknown = await Bun.file(
    join(ctx.root, result.envelope.truncatedPath ?? ''),
  ).json();

  const slice = streamSliceSchema.parse(payload);
  const records = slice.records.map((record) => `${JSON.stringify(record)}\n`).join('');

  expect({
    more: slice.more,
    cursor: slice.cursor,
    firstLine: slice.records[0]?.line,
    withinLimit: slice.cursor <= 64 * 1024,
  }).toStrictEqual({
    more: true,
    cursor: Buffer.byteLength(records),
    firstLine: 'order 1 placed for the spring catalogue: two mugs and a teapot',
    withinLimit: true,
  });
});

test('it fails the doctor when a source stopped recording', async () => {
  const ctx = await setupTest();

  await ctx.run('dead', ['attach']);

  const result = await waitFor(async () => {
    const doctor = await ctx.run('dead', ['doctor']);

    invariant(doctor.exitCode !== 0, 'The doctor still passes.');

    return doctor;
  });

  expect(result.envelope.data).toStrictEqual(
    expect.objectContaining({
      passed: false,
      results: [
        expect.objectContaining({
          name: 'stream.recording',
          status: 'failed',
          message: 'These streams stopped recording: jobs (exit code 1).',
        }),
      ],
    }),
  );
});
