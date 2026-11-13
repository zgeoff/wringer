import { expect, test } from 'bun:test';
import { collectJourneyDrives } from './collect-journey-drives.ts';
import type { RunEvent } from './run-events.ts';
import { buildMockEnvelope } from './test-utils/build-mock-envelope.ts';

function setupTest() {
  const at = '2026-11-04T10:00:00.000Z';

  return {
    passed: { type: 'doctor-passed', at, results: [] } satisfies RunEvent,
    failed: { type: 'doctor-failed', at, results: [] } satisfies RunEvent,
    done: {
      type: 'envelope',
      at,
      drive: false,
      envelope: buildMockEnvelope({
        command: 'done',
        feature: 'checkout',
        data: { feature: 'checkout' },
      }),
    } satisfies RunEvent,
    doneOf: (feature: string): RunEvent => ({
      type: 'envelope',
      at,
      drive: false,
      envelope: buildMockEnvelope({ command: 'done', feature: 'checkout', data: { feature } }),
    }),
    drive: (command: string, feature = 'checkout'): RunEvent => ({
      type: 'envelope',
      at,
      drive: true,
      envelope: buildMockEnvelope({ command, feature }),
    }),
    collect: (events: readonly RunEvent[]) =>
      collectJourneyDrives(events, 'checkout')?.map((envelope) => envelope.command) ?? null,
  };
}

test('it collects the drives of the feature between the doctor and its done, in order', () => {
  const ctx = setupTest();
  const events = [ctx.passed, ctx.drive('a'), ctx.drive('b', 'search'), ctx.drive('c'), ctx.done];

  expect(ctx.collect(events)).toStrictEqual(['a', 'c']);
});

test('it leaves out a drive from before the latest doctor', () => {
  const ctx = setupTest();

  expect(
    ctx.collect([ctx.passed, ctx.drive('old'), ctx.passed, ctx.drive('new'), ctx.done]),
  ).toStrictEqual(['new']);
});

test('it leaves out a drive after the done', () => {
  const ctx = setupTest();

  expect(ctx.collect([ctx.passed, ctx.drive('a'), ctx.done, ctx.drive('later')])).toStrictEqual([
    'a',
  ]);
});

test('it returns null when the log holds no done for the feature', () => {
  const ctx = setupTest();

  expect(ctx.collect([ctx.passed, ctx.drive('a')])).toBeNull();
});

test('it collects no drive that ran while the doctor had failed', () => {
  const ctx = setupTest();

  expect(ctx.collect([ctx.failed, ctx.drive('a'), ctx.done])).toStrictEqual([]);
});

test('it leaves out the drives of a feature whose done named another feature while it stayed selected', () => {
  const ctx = setupTest();
  const events = [ctx.passed, ctx.drive('a'), ctx.done, ctx.drive('later'), ctx.doneOf('search')];

  expect(ctx.collect(events)).toStrictEqual(['a']);
});
