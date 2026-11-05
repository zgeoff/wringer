import { z } from 'zod';
import { bindDrivers } from '../src/bind-drivers.ts';
import { createWringer } from '../src/create-wringer.ts';
import { local } from '../src/local.ts';
import type { Wringer } from '../src/types.ts';
import { notes } from './notes-driver.ts';

const emptySchema = z.strictObject({});
const countSchema = z.strictObject({ count: z.number() });
const textSchema = z.strictObject({ text: z.string() });
const tallySchema = z.strictObject({ count: z.bigint() });
const directorySchema = z.strictObject({ directory: z.string() });

// A verify CLI for tests: launch targets `local`, `broken` (exits first) and `slow` (ready after
// 0.5 s), read-only `prod` (hinted) and `archive`, `constructor`, named for an inherited key, and
// actions that read, write, keep evidence, hang, throw, flood and pause.
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
    .target(
      'constructor',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: { notes: () => ({}) },
      }),
    )
    .command({
      path: ['stock'],
      summary: 'Print the stock count, with or without a run',
      args: emptySchema,
      data: textSchema,
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: async (_args, ctx) => {
        const result = await ctx.exec(['echo', '12']);

        return { text: result.stdout.trim() };
      },
    })
    .command({
      path: ['shelf'],
      summary: 'List the notes on the shelf, without asking for a run',
      args: emptySchema,
      data: countSchema,
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: async (_args, ctx) => {
        const listed = await ctx.drivers.notes.list(null);

        return { count: listed.length };
      },
    })
    .command({
      path: ['restock'],
      summary: 'Restock the shelves, with no declared effect',
      args: emptySchema,
      data: emptySchema,
      run: () => Promise.resolve({}),
    })
    .command({
      path: ['recount'],
      summary: 'Recount the shelves without a run, failing after the timeout',
      args: emptySchema,
      data: emptySchema,
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: async () => {
        await Bun.sleep(200);

        throw new Error('The recount lost its place.');
      },
    })
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
        name: 'linger',
        summary: 'Run past the timeout, report its cleanup, then fail it',
        effect: 'read',

        // Long enough that a loaded machine still starts the body before the deadline.
        timeoutMs: 500,
        input: emptySchema,
        data: emptySchema,
        run: async (_input, ctx) => {
          await Bun.sleep(800);

          ctx.emit('cleanup', { step: 'remote work' });
          throw new Error('The cleanup could not stop the remote work.');
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'receipt',
        summary: 'Keep the receipt as evidence',
        effect: 'read',
        input: emptySchema,
        data: emptySchema,
        run: async (_input, ctx) => {
          await ctx.evidence.writeFile('note', 'receipt.txt', 'paid 12 for the cart');

          return {};
        },
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
        name: 'hoard',
        summary: 'Keep more notes as evidence than one log event can list',
        effect: 'read',
        input: emptySchema,
        data: emptySchema,
        run: async (_input, ctx) => {
          for (let index = 0; index < 400; index += 1) {
            await ctx.evidence.writeFile('note', 'cart.txt', `note ${index}`);
          }

          return {};
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'tally',
        summary: 'Return data that has no JSON form',
        effect: 'read',
        input: emptySchema,
        data: tallySchema,
        run: () => Promise.resolve({ count: 3n }),
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
