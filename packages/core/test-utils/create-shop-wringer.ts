import { z } from 'zod';
import { bindDrivers } from '../src/bind-drivers.ts';
import { createWringer } from '../src/create-wringer.ts';
import { local } from '../src/local.ts';
import type { Wringer } from '../src/types.ts';
import { notes } from './notes-driver.ts';

const emptySchema = z.strictObject({});
const countSchema = z.strictObject({ count: z.number() });
const textSchema = z.strictObject({ text: z.string() });
const directorySchema = z.strictObject({ directory: z.string() });

// A repo's verify CLI for tests: launch targets `local` (ready at once), `broken` (exits first) and
// `slow` (ready after half a second), read-only attach targets `prod` (with a hint) and `archive`
// (without), and actions that read, write, hang, throw, flood and pause.
export function createShopWringer(): Wringer {
  const shop = bindDrivers([notes({ prefix: '' })] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
        host: local(),
        launch: () => ({
          command: ['sh', '-c', `echo '{"event":"listening","port":4000}'; exec sleep 60`],
          ready: (line) =>
            line['event'] === 'listening'
              ? { web: `http://127.0.0.1:${String(line['port'])}` }
              : null,
        }),
        drivers: { notes: () => ({}) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'prod is read-only: reproduce it on local.',
        host: local(),
        endpoints: () => ({ web: 'https://shop.example' }),
        drivers: { notes: () => ({ readOnly: { add: ['granted'] } }) },
      }),
    )
    .target(
      'broken',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
        host: local(),
        launch: () => ({
          command: ['sh', '-c', 'echo starting; exit 3'],
          ready: () => null,
        }),
      }),
    )
    .target(
      'slow',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
        host: local(),
        launch: () => ({
          command: [
            'sh',
            '-c',
            `sleep 0.5; echo '{"event":"listening","port":4001}'; exec sleep 60`,
          ],
          ready: (line) =>
            line['event'] === 'listening' ? { web: 'http://127.0.0.1:4001' } : null,
        }),
      }),
    )
    .target(
      'archive',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        host: local(),
        drivers: { notes: () => ({}) },
      }),
    )
    .action(
      shop.defineAction({
        name: 'count',
        summary: 'Count the notes',
        effect: 'read',
        input: emptySchema,
        data: countSchema,
        run: async (_input, ctx) => {
          const listed = await ctx.drivers.notes.list(null);

          return { count: listed.length };
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'seed',
        summary: 'Add a seed note',
        effect: 'write',
        input: emptySchema,
        data: countSchema,
        run: async (_input, ctx) => ({ count: await ctx.drivers.notes.add({ text: 'seed' }) }),
      }),
    )
    .action(
      shop.defineAction({
        name: 'sneak',
        summary: 'Claim a read, then write',
        effect: 'read',
        input: emptySchema,
        data: countSchema,
        run: async (_input, ctx) => ({ count: await ctx.drivers.notes.add({ text: 'sneaky' }) }),
      }),
    )
    .action(
      shop.defineAction({
        name: 'local-only',
        summary: 'Run only on local',
        effect: 'read',
        targets: ['local'],
        input: emptySchema,
        data: emptySchema,
        run: () => Promise.resolve({}),
      }),
    )
    .action(
      shop.defineAction({
        name: 'hang',
        summary: 'Never finish',
        effect: 'read',
        timeoutMs: 50,
        input: emptySchema,
        data: emptySchema,
        run: () => Promise.withResolvers<Record<string, never>>().promise,
      }),
    )
    .action(
      shop.defineAction({
        name: 'crash',
        summary: 'Keep a note as evidence, then throw a plain error',
        effect: 'read',
        input: emptySchema,
        data: emptySchema,
        run: async (_input, ctx) => {
          await ctx.evidence.writeFile('note', 'cart.txt', 'the cart was empty');

          throw new TypeError('cannot read the cart');
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'flood',
        summary: 'Return more data than the cap',
        effect: 'read',
        input: emptySchema,
        data: textSchema,
        run: () => Promise.resolve({ text: 'x'.repeat(40 * 1024) }),
      }),
    )
    .action(
      shop.defineAction({
        name: 'pause',
        summary: 'Write to the `entered` FIFO, then wait to read a line from the `gate` FIFO',
        effect: 'write',
        input: directorySchema,
        data: emptySchema,
        run: async (input, ctx) => {
          await ctx.exec([
            'sh',
            '-c',
            'echo in > "$0/entered"; read line < "$0/gate"',
            input.directory,
          ]);

          return {};
        },
      }),
    )
    .feature({ name: 'checkout', summary: 'Pay for the cart', paths: ['src/checkout/**'] })
    .feature({ name: 'search', summary: 'Find a product', paths: ['src/search/**'] })
    .build();
}
