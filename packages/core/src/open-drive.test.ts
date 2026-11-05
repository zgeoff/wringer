import { expect, test } from 'bun:test';
import { z } from 'zod';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { bindDrivers } from './bind-drivers.ts';
import { createWringer } from './create-wringer.ts';
import { defineDriver } from './define-driver.ts';
import { dispatch } from './dispatch.ts';
import { local } from './local.ts';

async function setupTest() {
  // Its client reports the time its session has left.
  const clock = defineDriver({
    name: 'clock',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    client: (session) => ({ readTimeLeft: () => Promise.resolve(session.timeLeftMs()) }),
  });

  const bound = bindDrivers([clock({})] as const);
  const leftSchema = z.strictObject({ leftMs: z.number() });

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
        summary: 'Report the time left',
        effect: 'read',
        input: z.strictObject({}),
        data: leftSchema,
        run: async (_input, ctx) => ({ leftMs: await ctx.drivers.clock.readTimeLeft() }),
      }),
    )
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    run: (path: readonly string[], timeoutMs?: number) =>
      dispatch(wringer, path, {}, { ...shop.session, target: 'box', timeoutMs }),
    parseLeft: (data: unknown) => leftSchema.parse(data).leftMs,
  };
}

test('it gives a driver session the time left before the command deadline', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);
  await ctx.run(['doctor']);

  const result = await ctx.run(['action', 'left'], 5000);

  expect(ctx.parseLeft(result.envelope.data)).toBeWithin(4000, 5001);
});
