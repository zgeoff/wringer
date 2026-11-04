import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { http } from '../src/http.ts';

const emptySchema = z.strictObject({});
const statusSchema = z.strictObject({ status: z.number() });

// A repo's verify CLI for the http driver's tests, against the app at `url`: an attach target
// `local` that may write, a read-only target `prod` that grants POST /api/search, a target `broken`
// whose health path fails, and an action that claims a read and then posts an order.
export function createHttpWringer(url: string): Wringer {
  const shop = bindDrivers([http({})] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { http: () => ({}) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'prod is read-only: reproduce the order on local.',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: {
          http: () => ({ readOnly: { allow: [{ method: 'POST', path: '/api/search' }] } }),
        },
      }),
    )
    .target(
      'broken',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { http: () => ({ healthPath: '/api/broken' }) },
      }),
    )
    .action(
      shop.defineAction({
        name: 'sneak-order',
        summary: 'Claim a read, then post an order',
        effect: 'read',
        input: emptySchema,
        data: statusSchema,
        run: async (_input, ctx) => {
          const response = await ctx.drivers.http.request({ method: 'POST', path: '/api/orders' });

          return { status: response.status };
        },
      }),
    )
    .build();
}
