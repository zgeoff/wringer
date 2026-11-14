import { expect, test } from 'bun:test';
import { z } from 'zod';
import { local } from '../host/local.ts';
import { bindDrivers } from '../registry/bind-drivers.ts';
import { createWringer } from '../registry/create-wringer.ts';
import { defineDriver } from '../registry/define-driver.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { dispatch } from './dispatch.ts';

async function setupTest() {
  let nowMs = Date.parse('2026-11-05T09:00:00.000Z');

  const advanceClock = (stepMs: number): void => {
    nowMs += stepMs;
  };

  // Its client reports the time its session has left.
  const clock = defineDriver({
    name: 'clock',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    client: (session) => ({ readTimeLeft: () => Promise.resolve(session.timeLeftMs()) }),
  });

  const bound = bindDrivers([clock({})] as const);
  const readingsSchema = z.strictObject({ leftMs: z.array(z.number()) });

  // The action reads the time left, moves the clock 2 s, reads again, then moves it past the
  // deadline and reads once more.
  const wringer = createWringer({ name: 'shop' })
    .use(...bound.drivers)
    .target(
      'box',
      bound.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: { clock: () => ({}) },
      }),
    )
    .action(
      bound.defineAction({
        name: 'left',
        summary: 'Report the time left as the clock moves',
        effect: 'read',
        input: z.strictObject({}),
        data: readingsSchema,
        run: async (_input, ctx) => {
          const first = await ctx.drivers.clock.readTimeLeft();

          advanceClock(2000);

          const second = await ctx.drivers.clock.readTimeLeft();

          advanceClock(4000);

          const third = await ctx.drivers.clock.readTimeLeft();

          return { leftMs: [first, second, third] };
        },
      }),
    )
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    run: (path: readonly string[], timeoutMs?: number) =>
      dispatch(
        wringer,
        path,
        {},
        { ...shop.session, target: 'box', timeoutMs, now: () => new Date(nowMs) },
      ),
    parseReadings: (data: unknown) => readingsSchema.parse(data).leftMs,
  };
}

test('it gives a driver session the time left before the deadline, down to zero past it', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);
  await ctx.run(['doctor']);

  const result = await ctx.run(['action', 'left'], 5000);

  expect(ctx.parseReadings(result.envelope.data)).toStrictEqual([5000, 3000, 0]);
});
