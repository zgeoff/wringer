import { expect, test } from 'bun:test';
import { buildStubClock } from './build-stub-clock.ts';

test('it reads the start time before any sleep', () => {
  const clock = buildStubClock(5000);

  expect(clock.nowMs()).toBe(5000);
});

test('it moves the time on by each sleep’s duration', async () => {
  const clock = buildStubClock(5000);

  await clock.sleep(20);
  await clock.sleep(30);

  expect(clock.nowMs()).toBe(5050);
});
