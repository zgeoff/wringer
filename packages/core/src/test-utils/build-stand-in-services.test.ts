import { expect, mock, test } from 'bun:test';
import { createTempDir } from '@zgeoff/testing/fs';
import { buildRunHandle } from '../dispatch/build-run-handle.ts';
import { buildStandInServices } from './build-stand-in-services.ts';

function setupTest() {
  const directory = createTempDir('stand-in-services').path;
  const stop = Promise.withResolvers<undefined>();
  const start = Promise.withResolvers<undefined>();
  const hold = Promise.withResolvers<undefined>();
  const run = buildRunHandle(directory, 'mf3k2a-7q1z');
  const readLog = mock<(path: string) => Promise<string>>();

  return {
    readLog,
    services: buildStandInServices({
      stop: stop.promise,
      start: start.promise,
      hold: hold.promise,
      readLog,
    }),
    context: {
      exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      run,
    },
    stoppedContext: {
      exec: () => Promise.reject(new Error('The command was stopped.')),
      run,
    },
    openStopGate: () => {
      stop.resolve(undefined);
    },
    openStartGate: () => {
      start.resolve(undefined);
    },
    openHoldGate: () => {
      hold.resolve(undefined);
    },
    appLogPath: run.childLog('app').path,
  };
}

test('it fails the store stop once the stop gate opens, and records the stop', async () => {
  const ctx = setupTest();

  const store = await ctx.services.store.start(ctx.context);

  ctx.openStopGate();

  const [stopped] = await Promise.allSettled([store.stop()]);

  expect({ stopped, calls: ctx.services.calls }).toStrictEqual({
    stopped: { status: 'rejected', reason: expect.objectContaining({ code: 'environment' }) },
    calls: ['store'],
  });
});

test('it starts the queue only once the start gate opens, and records its stop', async () => {
  const ctx = setupTest();
  const starting = ctx.services.queue.start(ctx.context);

  ctx.openStartGate();

  const queue = await starting;

  await queue.stop();

  expect(ctx.services.calls).toStrictEqual(['queue']);
});

test('it records the exit code of the command the shelf stop runs', async () => {
  const ctx = setupTest();

  const shelf = await ctx.services.shelf.start(ctx.context);

  await shelf.stop();

  expect(ctx.services.calls).toStrictEqual(['shelf exited 0']);
});

test('it throws from the till stop before it returns a promise', async () => {
  const ctx = setupTest();

  const till = await ctx.services.till.start(ctx.context);

  expect(() => till.stop()).toThrow(expect.objectContaining({ code: 'environment' }));
});

test('it records each line of the app log, read through its log reader, when the ledger stops', async () => {
  const ctx = setupTest();

  const ledger = await ctx.services.ledger.start(ctx.context);

  ctx.readLog.mockResolvedValue('started\nclosing\n');

  await ledger.stop();

  expect({ calls: ctx.services.calls, read: ctx.readLog.mock.calls }).toStrictEqual({
    calls: ['started', 'closing'],
    read: [[ctx.appLogPath]],
  });
});

test('it settles the counter hold once the hold gate opens, and records the call', async () => {
  const ctx = setupTest();

  const counter = await ctx.services.counter.start(ctx.context);

  const holding = counter.methods['hold']?.(null, new AbortController().signal);

  ctx.openHoldGate();

  const held = await holding;

  expect({ held, calls: ctx.services.calls }).toStrictEqual({ held: null, calls: ['hold'] });
});

test('it answers the counter watch with the time its signal aborted', async () => {
  const ctx = setupTest();

  const counter = await ctx.services.counter.start(ctx.context);

  const cancel = new AbortController();

  const watching = counter.methods['watch']?.(null, cancel.signal);
  const abortedAtMs = Date.now();

  cancel.abort();

  const watched = await watching;

  expect(watched).toStrictEqual({
    cancelledAtMs: expect.toBeWithin(abortedAtMs, abortedAtMs + 1000),
  });
});

test('it starts the press once its command finishes, and records that it finished', async () => {
  const ctx = setupTest();

  await ctx.services.press.start(ctx.context);

  expect(ctx.services.calls).toStrictEqual(['press command fulfilled']);
});

test('it starts the press after its command is stopped, and records the stop', async () => {
  const ctx = setupTest();

  await ctx.services.press.start(ctx.stoppedContext);

  expect(ctx.services.calls).toStrictEqual(['press command rejected']);
});
