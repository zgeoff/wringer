import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { http } from '../src/http.ts';
import type { HttpTransport } from '../src/http.ts';

const emptySchema = z.strictObject({});
const statusSchema = z.strictObject({ status: z.number() });

// A verify CLI against the app at `url`, through `transport` when given, timing out at 500 ms: `local` may
// write, read-only `prod` grants POST /api/search, `broken` fails its health path, `bare` lacks the
// endpoint, `inherited` names one every object inherits, and an action claims a read, then posts.
export function createHttpWringer(url: string, transport?: HttpTransport): Wringer {
  const shop = bindDrivers([http({ timeoutMs: 500, transport })] as const);

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
    .target(
      'bare',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ admin: url }),
        drivers: { http: () => ({}) },
      }),
    )
    .target(
      'inherited',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { http: () => ({ endpoint: 'constructor' }) },
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
