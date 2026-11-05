import { expect, mock, test } from 'bun:test';
import { createActor, waitFor } from 'xstate';
import { appMachine } from './app-machine.ts';
import { WringerError } from './wringer-error.ts';

function setupTest() {
  const stop = Promise.withResolvers<undefined>();
  const reportCrash = mock<(reason: string) => void>();
  const killGroup = mock<() => void>();
  const stopApp = mock<() => Promise<void>>(() => stop.promise);

  const actor = createActor(appMachine, {
    input: { readyTimeoutMs: 100, reportCrash, killGroup, stopApp },
  });

  actor.start();

  return {
    actor,
    reportCrash,
    killGroup,
    stopApp,
    finishStop: () => {
      stop.resolve(undefined);
    },
    failStop: (message: string) => {
      stop.reject(new WringerError('environment', { message }));
    },
    waitForTag: (tag: 'settled' | 'done') =>
      waitFor(actor, (snapshot) => snapshot.hasTag(tag), { timeout: 2000 }),
  };
}

test('it keeps the endpoints of the ready line and stops the app once asked', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'ready', endpoints: { web: 'http://127.0.0.1:4100' } });

  const started = await ctx.waitForTag('settled');

  ctx.actor.send({ type: 'stop' });
  ctx.finishStop();

  const done = await ctx.waitForTag('done');

  expect({
    started: started.value,
    start: started.context.start,
    done: done.value,
    stops: ctx.stopApp.mock.calls.length,
    crashes: ctx.reportCrash.mock.calls,
  }).toStrictEqual({
    started: 'running',
    start: { kind: 'ready', endpoints: { web: 'http://127.0.0.1:4100' } },
    done: 'stopped',
    stops: 1,
    crashes: [],
  });
});

test('it fails the start of an app that exits before it is ready, after it stops what is left', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'exited', exitCode: 7 });
  ctx.finishStop();

  const done = await ctx.waitForTag('settled');

  expect({
    state: done.value,
    start: done.context.start,
    crashes: ctx.reportCrash.mock.calls,
    kills: ctx.killGroup.mock.calls.length,
    stops: ctx.stopApp.mock.calls.length,
  }).toStrictEqual({
    state: 'startFailed',
    start: {
      kind: 'failed',
      failure: expect.objectContaining({
        code: 'environment',
        message: 'The app exited with code 7.',
      }),
    },
    crashes: [['The app exited with code 7.']],
    kills: 1,
    stops: 1,
  });
});

test('it fails the start with a timeout when no ready line comes in time', async () => {
  const ctx = setupTest();

  ctx.finishStop();

  const done = await ctx.waitForTag('settled');

  expect({ state: done.value, start: done.context.start }).toStrictEqual({
    state: 'startFailed',
    start: { kind: 'failed', failure: expect.objectContaining({ code: 'timeout' }) },
  });
});

test('it fails the start without a crash report when the run stops first', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'abort' });
  ctx.finishStop();

  const done = await ctx.waitForTag('settled');

  expect({
    start: done.context.start,
    crashes: ctx.reportCrash.mock.calls,
  }).toStrictEqual({
    start: {
      kind: 'failed',
      failure: expect.objectContaining({ message: 'The run stopped before the app was ready.' }),
    },
    crashes: [],
  });
});

test('it reports a crash of a ready app once, however many failures follow', () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'ready', endpoints: {} });
  ctx.actor.send({ type: 'log.failed', reason: 'the disk is full' });
  ctx.actor.send({ type: 'exited', exitCode: 1 });

  expect(ctx.reportCrash.mock.calls).toStrictEqual([
    ["The app's output could not be logged: the disk is full"],
  ]);
});

test('it keeps a log failure that comes while the app stops, and reports no crash', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'ready', endpoints: {} });
  ctx.actor.send({ type: 'stop' });
  ctx.actor.send({ type: 'log.failed', reason: 'the disk is full' });
  ctx.finishStop();

  const done = await ctx.waitForTag('done');

  expect({
    logFailure: done.context.logFailure,
    crashes: ctx.reportCrash.mock.calls,
  }).toStrictEqual({ logFailure: 'the disk is full', crashes: [] });
});

test('it keeps the failure of a stop', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'ready', endpoints: {} });
  ctx.actor.send({ type: 'stop' });
  ctx.failStop('The app kept its log open.');

  const done = await ctx.waitForTag('done');

  expect(done.context.stopFailure?.message).toBe('The app kept its log open.');
});
