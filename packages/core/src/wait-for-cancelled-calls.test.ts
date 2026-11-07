import { expect, onTestFinished, test } from 'bun:test';
import { waitForCancelledCalls } from './wait-for-cancelled-calls.ts';
import { WringerError } from './wringer-error.ts';

function setupTest() {
  const held = Promise.withResolvers<unknown>();

  onTestFinished(() => {
    held.resolve(null);
  });

  return { neverSettles: held.promise };
}

test('it resolves null for calls that answered or timed out', async () => {
  setupTest();

  const failure = await waitForCancelledCalls([
    Promise.resolve({ notes: 2 }),
    Promise.reject(new WringerError('timeout')),
  ]);

  expect(failure).toBeNull();
});

test('it keeps a cancel failure that came before the bound while another call never settles', async () => {
  const ctx = setupTest();

  const failure = await waitForCancelledCalls([
    Promise.reject(new WringerError('environment', { message: 'The page did not close.' })),
    ctx.neverSettles,
  ]);

  expect(failure?.message).toBe('The page did not close.');
});

test('it answers a call that never settles with an environment error, as its work may still run', async () => {
  const ctx = setupTest();

  const failure = await waitForCancelledCalls([ctx.neverSettles]);

  expect(failure?.code).toBe('environment');
});

test('it answers a call that failed with a plain error as an internal failure', async () => {
  setupTest();

  const failure = await waitForCancelledCalls([Promise.reject(new Error('socket gone'))]);

  expect(failure?.code).toBe('internal');
});
