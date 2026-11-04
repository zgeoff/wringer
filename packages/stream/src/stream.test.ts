import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { waitFor } from '../../core/test-utils/wait-for.ts';
import { createStreamWringer } from '../test-utils/create-stream-wringer.ts';
import { streamSliceSchema } from './stream.ts';

async function setupTest() {
  const triggers = await createTestFolder(import.meta.dir, 'stream-triggers');

  onTestFinished(() => rm(triggers, { recursive: true, force: true }));

  const wringer = createStreamWringer(triggers);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    placeOrder: () => writeFile(join(triggers, 'order'), ''),
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

    return read.includes('booted') ? read : null;
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

    return slice.records.some((record) => record.line === 'booted') ? true : null;
  });

  await ctx.run('local', ['use'], { feature: undefined });
  await ctx.placeOrder();

  const lines = await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    return slice.records.length > 0 ? slice.records.map((record) => record.line) : null;
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

    return slice.records.some((record) => record.line === 'booted') ? true : null;
  });

  await ctx.run('local', ['use'], { feature: undefined });
  await ctx.run('local', ['down']);
  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('local', ['stream', 'read'], { name: 'app' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    return slice.records.length > 0 ? slice.records.map((record) => record.line) : null;
  });

  expect(lines).toStrictEqual(['{"event":"listening","port":4000}', 'booted']);
});

test('it records a command source on an attach target', async () => {
  const ctx = await setupTest();

  await ctx.run('box', ['attach']);
  await ctx.run('box', ['doctor']);

  const lines = await waitFor(async () => {
    const result = await ctx.run('box', ['stream', 'read'], { name: 'jobs' });

    const slice = streamSliceSchema.parse(result.envelope.data);

    return slice.records.length > 0 ? slice.records.map((record) => record.line) : null;
  });

  expect(lines).toStrictEqual(['job 1 done']);
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
      hint: 'Read one of: jobs.',
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

test('it fails the doctor when a source stopped recording', async () => {
  const ctx = await setupTest();

  await ctx.run('dead', ['attach']);

  const result = await waitFor(async () => {
    const doctor = await ctx.run('dead', ['doctor']);

    return doctor.exitCode === 0 ? null : doctor;
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
