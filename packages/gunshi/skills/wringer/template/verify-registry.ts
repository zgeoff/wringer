import { createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { http } from '@wringer/http';
import { z } from 'zod';

const itemSchema = z.strictObject({ id: z.number().int(), name: z.string() });

// The verify registry of an example app, Larder, which lists the items in a pantry. Replace each
// target, action, command, check and feature with the repo's own; keep the shape.
export function createVerifyRegistry(): Wringer {
  return createWringer({ name: 'larder' })
    .use(http({}))
    .target('local', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: () => ({
        command: ['bun', 'run', 'dev'],
        ready: (line) =>
          line['event'] === 'listening'
            ? { web: `http://127.0.0.1:${String(line['port'])}` }
            : null,
      }),
      drivers: { http: () => ({ healthPath: '/api/health' }) },
    })
    .target('shared', {
      mode: 'attach',
      access: 'read-only',
      refusalHint:
        'This target is read-only. Leave the write undone, skip `done` for this feature, and report the write you needed.',
      host: local(),
      endpoints: () => ({ web: 'https://larder.example' }),
      drivers: { http: () => ({ healthPath: '/api/health' }) },
    })
    .action({
      name: 'add-item',
      summary: 'Add an item to the pantry through the API',
      effect: 'write',
      input: z.strictObject({ name: z.string().min(1) }),
      data: itemSchema,
      run: async (input, ctx) => {
        const response = await ctx.drivers.http.request({
          method: 'POST',
          path: '/api/items',
          json: input,
        });

        return itemSchema.parse(response.json);
      },
    })
    .command({
      path: ['items', 'count'],
      summary: 'Count the items in the pantry',
      args: z.strictObject({}),
      data: z.strictObject({ count: z.number().int() }),
      effect: 'read',
      run: async (_args, ctx) => {
        const response = await ctx.drivers.http.request({ path: '/api/items' });

        return { count: z.array(itemSchema).parse(response.json).length };
      },
    })
    .check({
      name: 'items-api',
      input: z.strictObject({}),
      data: z.null(),
      timeoutMs: 5000,
      run: async (_input, ctx) => {
        const response = await ctx.drivers.http.request({ path: '/api/items' });

        z.array(itemSchema).parse(response.json);

        return null;
      },
    })
    .feature({
      name: 'add-item',
      summary: 'Add an item from the pantry page',
      paths: ['src/items/**', 'src/pages/pantry/**'],
    })
    .ignore('docs/**', '**/*.md', '**/*.test.ts', '.github/**', '.claude/**', 'scripts/verify/**')
    .build();
}
