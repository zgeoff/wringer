import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { http } from '../http.ts';
import type { HttpTransport } from '../http.ts';
import { ADMIN_API_URL } from './shop-handlers.ts';

type HttpOptions = NonNullable<Parameters<typeof http>[0]>;

const emptySchema = z.strictObject({});
const statusSchema = z.strictObject({ status: z.number() });
const pathSchema = z.strictObject({ path: z.string() });
const tokenSchema = z.strictObject({ token: z.string() });
const sentSchema = z.strictObject({ sent: z.string(), isReal: z.boolean() });

// A verify CLI against the app at `url`, through `transport` when given, timing out at 500 ms.
// `local` may write; read-only `prod` grants POST /api/search; `multi` and `multi-prod` add an admin
// endpoint, and `target-only` names it in the target alone; `broken`, `bare`, `inherited`, `public` and `based` each break one config rule.
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
    .target(
      'multi',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url, admin: ADMIN_API_URL, db: 'data/shop.sqlite' }),
        drivers: {
          http: () => ({
            endpoints: { admin: { healthPath: '/api/health', healthAuth: false } },
          }),
        },
      }),
    )
    .target(
      'target-only',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url, admin: ADMIN_API_URL }),
        drivers: { http: () => ({}) },
      }),
    )
    .target(
      'multi-prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        host: local(),
        endpoints: () => ({ web: url, admin: ADMIN_API_URL }),
        drivers: {
          http: () => ({
            endpoints: { admin: {} },
            readOnly: {
              allow: [
                { method: 'POST', path: '/api/search' },
                { method: 'POST', path: '/api/audit', endpoint: 'admin' },
              ],
            },
          }),
        },
      }),
    )
    .target(
      'public',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: url }),
        drivers: { http: () => ({ healthAuth: false }) },
      }),
    )
    .target(
      'based',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        endpoints: () => ({ web: 'https://unused.example', admin: ADMIN_API_URL }),
        drivers: {
          http: () => ({ baseURL: url, endpoints: { admin: {} } }),
        },
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
