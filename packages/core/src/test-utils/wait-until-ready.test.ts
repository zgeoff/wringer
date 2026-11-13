import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { readRemainingMs, waitUntilReady } from './wait-until-ready.ts';

test('#waitUntilReady resolves once the probe answers ready', async () => {
  let calls = 0;

  const probe = () => {
    calls += 1;

    return Promise.resolve(calls === 3);
  };

  await expect(
    waitUntilReady(probe, {
      label: 'Postgres',
      deadlineAtMs: Date.now() + 5000,
      signal: new AbortController().signal,
    }),
  ).toResolve();
});

test('#waitUntilReady rejects as not ready when a probe never answers ready by the deadline', () => {
  expect(
    waitUntilReady(() => Promise.resolve(false), {
      label: 'Postgres',
      deadlineAtMs: Date.now() + 50,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrowWithMessage(Error, 'Postgres was not ready before the setup budget ran out');
});

test('#waitUntilReady starts no probe after the test ends', () => {
  const testEnd = new AbortController();

  let calls = 0;

  const probe = () => {
    calls += 1;

    testEnd.abort();

    return Promise.resolve(false);
  };

  expect(
    waitUntilReady(probe, {
      label: 'Postgres',
      deadlineAtMs: Date.now() + 60_000,
      signal: testEnd.signal,
    }),
  ).rejects.toThrowWithMessage(Error, 'Postgres was not ready before the test ended');

  expect(calls).toBe(1);
});

test('#waitUntilReady aborts the probe in flight when the test ends', () => {
  const testEnd = new AbortController();

  const seen: boolean[] = [];

  const probe = async (signal: AbortSignal) => {
    await once(signal, 'abort');

    seen.push(signal.aborted);

    return false;
  };

  const waiting = waitUntilReady(probe, {
    label: 'Postgres',
    deadlineAtMs: Date.now() + 60_000,
    signal: testEnd.signal,
  });

  testEnd.abort();

  expect(waiting).rejects.toThrowWithMessage(Error, 'Postgres was not ready before the test ended');
  expect(seen).toStrictEqual([true]);
});

test('#readRemainingMs rejects a step that starts after the deadline', () => {
  expect(() => readRemainingMs(Date.now() - 1, 'docker build')).toThrowWithMessage(
    Error,
    'the setup budget ran out before docker build',
  );
});

test('#readRemainingMs returns the time left before the deadline', () => {
  expect(readRemainingMs(Date.now() + 5000, 'docker build')).toBeWithin(4900, 5001);
});
