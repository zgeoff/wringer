import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { createWringer } from '../create-wringer.ts';
import { defineDriver } from '../define-driver.ts';
import { dispatch } from '../dispatch.ts';
import { local } from '../local.ts';
import { probeProcess } from '../probe-process.ts';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { WringerError } from '../wringer-error.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'doctor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const pidPath = join(directory, 'check.pid');
  const scribblePath = join(directory, 'scribble.txt');
  const shelfGate = Promise.withResolvers<void>();

  const clock = defineDriver({
    name: 'clock',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    client: () => ({}),
    checks: [
      {
        name: 'hang',
        timeoutMs: 100,
        run: async (ctx) => {
          await ctx.session.exec(['sh', '-c', `echo $$ > '${pidPath}'; exec sleep 30`], 'read');
        },
      },
      {
        name: 'ledger',
        timeoutMs: 1000,
        run: () => {
          throw new WringerError('check-failed', { message: 'The ledger is unbalanced.' });
        },
      },
    ],
  });

  const tillHeld = Promise.withResolvers<void>();

  onTestFinished(() => {
    tillHeld.resolve();
  });

  // The drawer's call fails once its check's own deadline cancels it; the wait then runs on until
  // the doctor's deadline.
  const till = defineDriver({
    name: 'till',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    client: (session) => ({
      count: () => session.service('drawer').call('count', null),
    }),
    checks: [
      {
        name: 'drawer',
        timeoutMs: 100,
        run: async (ctx) => {
          await ctx.client.count();
        },
      },
      {
        name: 'wait',
        timeoutMs: 5000,
        run: () => tillHeld.promise,
      },
    ],
  });

  const wringer = createWringer({ name: 'shop' })
    .use(clock({}))
    .use(till({}))
    .target('box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { clock: () => ({}) },
    })
    .target('till-box', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      drivers: { till: () => ({}) },
    })
    .check({
      name: 'note',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 1000,
      run: async (_input, ctx) => {
        await ctx.evidence.writeFile('note', 'cart.txt', 'the cart was empty');

        throw new WringerError('check-failed', { message: 'The cart was empty.' });
      },
    })
    .check({
      name: 'scribble',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 1000,
      run: async (_input, ctx) => {
        await ctx.exec(['sh', '-c', `echo restocked > '${scribblePath}'`]);

        return {};
      },
    })
    .check({
      name: 'shelf',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 100,
      run: async () => {
        await shelfGate.promise;

        throw new WringerError('check-failed', { message: 'The shelf count came back short.' });
      },
    })
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    probeScribble: () => Bun.file(scribblePath).exists(),
    readRun: (runID: string) => shop.state.readRun(runID),
    readEvents: (runID: string) => shop.state.readRunEvents(runID),
    releaseShelf: () => {
      shelfGate.resolve();
    },
    runWithin: (path: readonly string[], timeoutMs: number) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'box', timeoutMs }),
    runOnTill: (path: readonly string[]) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'till-box' }),

    // Each service call fails once its signal aborts, as a cancel that could not stop its work.
    runTillDoctorWithin: (timeoutMs: number) =>
      dispatch(
        wringer,
        ['doctor'],
        {},
        {
          ...shop.session,
          target: 'till-box',
          timeoutMs,
          supervisor: {
            ...shop.session.supervisor,
            call: async (call) => {
              await once(call.signal, 'abort');

              throw new WringerError('environment', { message: 'The drawer jammed.' });
            },
          },
        },
      ),
    readPID: async () => {
      const text = await readFile(pidPath, 'utf8');

      return Number(text);
    },
    run: (path: readonly string[]) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'box' }),
  };
}

test('it stops the work of a check that ran past its own deadline', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);
  const pid = await ctx.readPID();

  const stopped = await waitFor(() => {
    invariant(!probeProcess(pid), 'The check is still running.');

    return true;
  });

  expect({ exitCode: result.exitCode, stopped }).toStrictEqual({ exitCode: 1, stopped: true });
});

test('it logs the failure of a check that ends after its own deadline to the run', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);
  const result = await ctx.run(['doctor']);
  const early = await Promise.race([result.late, setImmediate('pending')]);

  ctx.releaseShelf();

  await result.late;

  const events = await ctx.readEvents(attached.envelope.instance ?? '');

  expect({
    early,
    shelf: events.filter(
      (event) => event.type === 'late-failure' && event.command.endsWith('shelf'),
    ),
  }).toStrictEqual({
    early: 'pending',
    shelf: [
      {
        type: 'late-failure',
        at: expect.any(String),
        command: 'doctor shelf',
        code: 'check-failed',
        message: 'The shelf count came back short.',
      },
    ],
  });
});

test('it records a check that throws before it returns as failed, and runs the checks after it', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);

  await ctx.run(['doctor']);

  const view = await ctx.readRun(attached.envelope.instance ?? '');

  expect({
    doctor: view?.doctor,
    ledger: view?.doctorResults.find((check) => check.name === 'clock.ledger')?.code,
    shelf: view?.doctorResults.find((check) => check.name === 'shelf')?.code,
  }).toStrictEqual({ doctor: 'failed', ledger: 'check-failed', shelf: 'timeout' });
});

test('it lists the evidence a failed check kept in the doctor envelope', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);

  expect(result.envelope.evidence).toStrictEqual([
    {
      kind: 'note',
      path: expect.stringMatching(/cart\.txt$/u),
      sha256: expect.any(String),
      scrub: 'text',
    },
  ]);
});

test('it answers a timeout, not the failure of a check call that its own deadline cancelled earlier', async () => {
  const ctx = await setupTest();

  await ctx.runOnTill(['attach']);

  const result = await ctx.runTillDoctorWithin(400);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 5,
    code: 'timeout',
  });
});

test('it starts no check once the doctor ran past its own deadline', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);

  const runID = attached.envelope.instance ?? '';

  await ctx.runWithin(['doctor'], 50);

  const view = await waitFor(async () => {
    const read = await ctx.readRun(runID);

    invariant(read?.doctor === 'failed', 'The doctor has not failed yet.');

    return read;
  });

  expect(view.doctorResults.map((check) => [check.name, check.code])).toStrictEqual([
    ['clock.hang', 'timeout'],
    ['clock.ledger', 'timeout'],
    ['note', 'timeout'],
    ['scribble', 'timeout'],
    ['shelf', 'timeout'],
  ]);
});

test('it refuses a write from a check on a read-write target, which stays unchanged', async () => {
  const ctx = await setupTest();
  const attached = await ctx.run(['attach']);

  await ctx.run(['doctor']);

  const view = await ctx.readRun(attached.envelope.instance ?? '');
  const scribbled = await ctx.probeScribble();

  expect({
    scribble: view?.doctorResults.find((check) => check.name === 'scribble')?.code,
    scribbled,
  }).toStrictEqual({ scribble: 'read-only', scribbled: false });
});
