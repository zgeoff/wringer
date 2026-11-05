import { expect, test } from 'bun:test';
import { waitOrAbort } from './wait-or-abort.ts';

test('it settles at once when the signal aborts during the wait', async () => {
  const controller = new AbortController();

  const startedMs = performance.now();
  const waiting = waitOrAbort(60_000, controller.signal);

  controller.abort();

  await waiting;

  expect(performance.now() - startedMs).toBeLessThan(1000);
});

test('it settles without rejecting on a signal that aborted already', async () => {
  await expect(waitOrAbort(60_000, AbortSignal.abort())).resolves.toBeUndefined();
});
