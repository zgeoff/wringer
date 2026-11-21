import { expect, test } from 'bun:test';
import type { PageSnapshot } from '../browser.ts';
import { createFakeClock } from '../test-utils/create-fake-clock.ts';
import type { SnapshotTextWait } from './wait-for-snapshot-text.ts';
import { waitForSnapshotText } from './wait-for-snapshot-text.ts';

// A null snapshot is one that never finishes.
function setupTest(snapshots: readonly (string | null)[], deadlineMs = 120_000) {
  const clock = createFakeClock();
  let taken = 0;

  const takeSnapshot = (): Promise<PageSnapshot> => {
    const text = snapshots[Math.min(taken, snapshots.length - 1)] ?? null;

    taken += 1;

    if (text === null) {
      return Promise.withResolvers<PageSnapshot>().promise;
    }

    return Promise.resolve({ url: 'http://shop.test/', title: 'Shop', snapshot: text });
  };

  return {
    clock,
    taken: () => taken,
    wait: (request: SnapshotTextWait) =>
      clock.runUntilSettled(
        waitForSnapshotText(request, {
          takeSnapshot,
          wait: clock.wait,
          timeLeftMs: () => deadlineMs - clock.nowMs(),
        }),
      ),
  };
}

test('it returns the first snapshot at once when it shows the text', async () => {
  const ctx = setupTest(['heading "Saved"']);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 10_000 });

  expect({ outcome, taken: ctx.taken(), nowMs: ctx.clock.nowMs() }).toStrictEqual({
    outcome: {
      kind: 'matched',
      snapshot: { url: 'http://shop.test/', title: 'Shop', snapshot: 'heading "Saved"' },
    },
    taken: 1,
    nowMs: 0,
  });
});

test('it returns the third snapshot when the text shows after 2 polls', async () => {
  const ctx = setupTest(['status "Saving"', 'status "Saving"', 'heading "Saved"']);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 10_000 });

  expect({ kind: outcome.kind, taken: ctx.taken(), nowMs: ctx.clock.nowMs() }).toStrictEqual({
    kind: 'matched',
    taken: 3,
    nowMs: 500,
  });
});

test('it times out after the action timeout when the text never shows', async () => {
  const ctx = setupTest(['status "Saving"']);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 1000 });

  expect(outcome).toStrictEqual({
    kind: 'timed-out',
    last: { url: 'http://shop.test/', title: 'Shop', snapshot: 'status "Saving"' },
    waitedMs: 1000,
    unmet: ['never showed the text "Saved"'],
  });
});

test('it waits for a snapshot that has the first text and lacks the second', async () => {
  const ctx = setupTest([
    'status "Saving"',
    'heading "Saved" status "Saving"',
    'heading "Saved"',
    'heading "Saved"',
  ]);

  const outcome = await ctx.wait({
    untilText: 'Saved',
    untilNoText: 'Saving',
    actionTimeoutMs: 10_000,
  });

  expect({ kind: outcome.kind, taken: ctx.taken() }).toStrictEqual({ kind: 'matched', taken: 3 });
});

test('it names each unmet condition when both flags time out', async () => {
  const ctx = setupTest(['status "Saving"']);

  const outcome = await ctx.wait({
    untilText: 'Saved',
    untilNoText: 'Saving',
    actionTimeoutMs: 500,
  });

  expect(outcome).toMatchObject({
    kind: 'timed-out',
    unmet: ['never showed the text "Saved"', 'still shows the text "Saving"'],
  });
});

test('it stops 2 seconds before the command deadline', async () => {
  const ctx = setupTest(['status "Saving"'], 3000);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 10_000 });

  expect(outcome).toMatchObject({ kind: 'timed-out', waitedMs: 1000 });
});

test('it takes only the first snapshot when the deadline reserve is already used', async () => {
  const ctx = setupTest(['status "Saving"'], 1500);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 10_000 });

  expect({ kind: outcome.kind, taken: ctx.taken() }).toStrictEqual({ kind: 'timed-out', taken: 1 });
});

test('it times out with the last finished snapshot when a later snapshot stalls', async () => {
  const ctx = setupTest(['status "Saving"', null]);

  const outcome = await ctx.wait({ untilText: 'Saved', actionTimeoutMs: 1000 });

  expect(outcome).toStrictEqual({
    kind: 'timed-out',
    last: { url: 'http://shop.test/', title: 'Shop', snapshot: 'status "Saving"' },
    waitedMs: 1000,
    unmet: ['never showed the text "Saved"'],
  });
});
