import { expect, test } from 'bun:test';
import { buildStubClock } from './build-stub-clock.ts';

test('it reads the Unix epoch before a time is set', () => {
  const clock = buildStubClock();

  expect(clock.now().toISOString()).toBe('1970-01-01T00:00:00.000Z');
});

test('it reads the time it was set to', () => {
  const clock = buildStubClock();

  clock.set('2026-04-12T07:15:00.000Z');

  expect(clock.now().toISOString()).toBe('2026-04-12T07:15:00.000Z');
});

test('it hands out a new date each read, so a caller cannot move the clock', () => {
  const clock = buildStubClock();

  clock.set('2026-04-12T07:15:00.000Z');
  clock.now().setFullYear(1999);

  expect(clock.now().toISOString()).toBe('2026-04-12T07:15:00.000Z');
});
