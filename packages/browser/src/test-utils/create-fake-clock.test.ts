import { expect, test } from 'bun:test';
import { createFakeClock } from './create-fake-clock.ts';

test('it moves fake time to the end of a wait', async () => {
  const clock = createFakeClock();

  await clock.runUntilSettled(clock.wait(300, new AbortController().signal));

  expect(clock.nowMs()).toBe(300);
});

test('it leaves a cancelled wait out of the time it moves', async () => {
  const clock = createFakeClock();

  const cancel = new AbortController();

  const cancelled = Promise.allSettled([clock.wait(5000, cancel.signal)]);

  cancel.abort();

  await clock.runUntilSettled(clock.wait(100, new AbortController().signal));

  expect({ now: clock.nowMs(), cancelled: await cancelled }).toStrictEqual({
    now: 100,
    cancelled: [{ status: 'rejected', reason: expect.any(Error) }],
  });
});
