import { expect, mock, test } from 'bun:test';
import { createActor, waitFor } from 'xstate';
import { supervisorMachine } from './supervisor-machine.ts';
import type { ShutDownPlan } from './supervisor-machine.ts';
import { WringerError } from './wringer-error.ts';

function setupTest() {
  const startup = Promise.withResolvers<undefined>();

  const shutDown = mock<(plan: ShutDownPlan) => Promise<WringerError | null>>(() =>
    Promise.resolve(null),
  );

  const cleanUpLate = mock(() => Promise.resolve());

  const startupAbort = new AbortController();

  const actor = createActor(supervisorMachine, {
    input: {
      stopWaitMs: 50,
      startUp: () => startup.promise,
      abortStartup: () => {
        startupAbort.abort();
      },
      shutDown,
      cleanUpLate,
    },
  });

  actor.start();

  return {
    actor,
    shutDown,
    cleanUpLate,
    startupAborted: () => startupAbort.signal.aborted,
    finishStartup: () => {
      startup.resolve(undefined);
    },
    failStartup: (message: string) => {
      startup.reject(new WringerError('environment', { message }));
    },
    waitForState: (state: 'running' | 'waitingForStartup' | 'closed' | 'ended') =>
      waitFor(actor, (snapshot) => snapshot.matches(state), { timeout: 2000 }),
  };
}

test('it shuts a running run down with the reason of the first stop', async () => {
  const ctx = setupTest();

  ctx.finishStartup();

  await ctx.waitForState('running');

  ctx.actor.send({ type: 'stop', reason: 'the app crashed' });
  ctx.actor.send({ type: 'stop', reason: null });

  await ctx.waitForState('ended');

  expect(ctx.shutDown.mock.calls).toStrictEqual([
    [{ crashReason: 'the app crashed', gaveUpOnStartup: false }],
  ]);
});

test('it aborts a startup that a stop interrupts and shuts down once the startup settles', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'stop', reason: null });

  await ctx.waitForState('waitingForStartup');

  ctx.failStartup('The launch was aborted.');

  await ctx.waitForState('ended');

  expect({
    aborted: ctx.startupAborted(),
    shutDown: ctx.shutDown.mock.calls,
  }).toStrictEqual({ aborted: true, shutDown: [[{ crashReason: null, gaveUpOnStartup: false }]] });
});

test('it shuts down with the reason of a startup that failed on its own', async () => {
  const ctx = setupTest();

  ctx.failStartup('The app never listened.');

  await ctx.waitForState('ended');

  expect(ctx.shutDown.mock.calls).toStrictEqual([
    [{ crashReason: 'The app never listened.', gaveUpOnStartup: false }],
  ]);
});

test('it gives up on a startup that ignores the stop, then cleans up late once it settles', async () => {
  const ctx = setupTest();

  ctx.actor.send({ type: 'stop', reason: null });

  await ctx.waitForState('closed');

  const lateBeforeStartup = ctx.cleanUpLate.mock.calls.length;

  ctx.finishStartup();

  await ctx.waitForState('ended');

  expect({
    shutDown: ctx.shutDown.mock.calls,
    lateBeforeStartup,
    lateAfterStartup: ctx.cleanUpLate.mock.calls.length,
  }).toStrictEqual({
    shutDown: [[{ crashReason: null, gaveUpOnStartup: true }]],
    lateBeforeStartup: 0,
    lateAfterStartup: 1,
  });
});

test('it keeps the failure of the final log write for every stop to read', async () => {
  const ctx = setupTest();

  const failure = new WringerError('environment', { message: 'The log is full.' });

  ctx.shutDown.mockImplementation(() => Promise.resolve(failure));
  ctx.finishStartup();

  await ctx.waitForState('running');

  ctx.actor.send({ type: 'stop', reason: null });

  const ended = await ctx.waitForState('ended');

  expect(ended.context.failure).toBe(failure);
});
