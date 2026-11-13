import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { http } from '../http.ts';
import type { HttpTransport } from '../http.ts';

type HttpOptions = NonNullable<Parameters<typeof http>[0]>;

const emptySchema = z.strictObject({});
const statusSchema = z.strictObject({ status: z.number() });
const pathSchema = z.strictObject({ path: z.string() });
const tokenSchema = z.strictObject({ token: z.string() });
const sentSchema = z.strictObject({ sent: z.string(), isReal: z.boolean() });

// A verify CLI against the app at `url`, through `transport` when given, timing out at 500 ms: `local` may
// write, read-only `prod` grants POST /api/search, `broken` fails its health path, `bare` lacks the
// endpoint, `inherited` names one every object inherits, and an action claims a read, then posts.
export function createHttpWringer(
  url: string,
  transport?: HttpTransport,
  redact?: HttpOptions['redact'],
): Wringer {
  const shop = bindDrivers([http({ timeoutMs: 500, transport, redact })] as const);

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
    .action(
      shop.defineAction({
        name: 'post-to',
        summary: 'Claim a read, then post to the path it is given',
        effect: 'read',
        input: pathSchema,
        data: statusSchema,
        run: async (input, ctx) => {
          const response = await ctx.drivers.http.request({ method: 'POST', path: input.path });

          return { status: response.status };
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'send-auth',
        summary: 'Send a request with a bearer token, and return what was sent',
        effect: 'read',
        input: tokenSchema,
        data: sentSchema,
        run: async (input, ctx) => {
          const authorization = `Bearer ${input.token}`;

          const response = await ctx.drivers.http.request({
            path: '/api/cart',
            headers: { authorization },
            evidence: false,
          });

          return {
            sent: authorization,
            isReal: response.body === '{"method":"GET","path":"/api/cart"}',
          };
        },
      }),
    )
    .build();
}
