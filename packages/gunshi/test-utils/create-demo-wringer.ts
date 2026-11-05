import { createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';

const greetInputSchema = z.strictObject({
  name: z.string().min(1),
  times: z.number().int().positive().default(1),
  tags: z.array(z.string()).default([]),
  loud: z.boolean().default(false),
});

const greetDataSchema = z.strictObject({ greeting: z.string(), tags: z.array(z.string()) });

const labelArgsSchema = z.strictObject({
  shelf: z.string().min(1),
  item: z.string().min(1),
  label: z.string().default('sample'),
  finish: z.enum(['', 'matte', 'gloss']).default('matte'),
});

const addressSchema = z.strictObject({ street: z.string(), town: z.string() });
const postSchema = z.strictObject({ mode: z.literal('post'), address: addressSchema });
const pickupSchema = z.strictObject({ mode: z.literal('pickup'), counter: z.string().min(1) });
const shipArgsSchema = z.discriminatedUnion('mode', [postSchema, pickupSchema]);

const tiltArgsSchema = z.strictObject({
  degrees: z.number(),
  steps: z.array(z.number()).default([]),
});

// A repo's verify CLI for the adapter's tests: targets `local` and read-only `prod`, an action with
// every flag type, commands with positionals, union arguments or signed numbers, a command that
// never finishes, and a doctor check that passes.
export function createDemoWringer(): Wringer {
  return createWringer({ name: 'demo' })
    .target('local', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: () => ({
        command: ['sh', '-c', `echo '{"event":"listening","port":4300}'; exec sleep 60`],
        ready: (line) => (line['event'] === 'listening' ? { web: 'http://127.0.0.1:4300' } : null),
      }),
    })
    .target('prod', {
      mode: 'attach',
      access: 'read-only',
      host: local(),
      endpoints: () => ({ web: 'https://demo.example' }),
    })
    .action({
      name: 'greet',
      summary: 'Greet someone',
      effect: 'read',
      input: greetInputSchema,
      data: greetDataSchema,
      run: (input) => {
        const word = input.loud ? 'HELLO' : 'hello';

        return Promise.resolve({
          greeting: Array.from({ length: input.times }, () => `${word} ${input.name}`).join(' '),
          tags: input.tags,
        });
      },
    })
    .command({
      path: ['label'],
      summary: 'Label an item on a shelf',
      args: labelArgsSchema,
      positionals: ['shelf', 'item'],
      data: labelArgsSchema,
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: (args) => Promise.resolve(args),
    })
    .command({
      path: ['ship'],
      summary: 'Ship an order by post or for pickup',
      args: shipArgsSchema,
      data: shipArgsSchema,
      decideEffect: (args) => (args.mode === 'post' ? 'write' : 'read'),
      needsRun: false,
      needsDoctor: false,
      run: (args) => Promise.resolve(args),
    })
    .command({
      path: ['tilt'],
      summary: 'Tilt a shelf by signed degrees, in steps',
      args: tiltArgsSchema,
      data: tiltArgsSchema,
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: (args) => Promise.resolve(args),
    })
    .command({
      path: ['wait'],
      summary: 'Wait for a delivery that never comes',
      args: z.strictObject({}),
      data: z.strictObject({}),
      effect: 'read',
      needsRun: false,
      needsDoctor: false,
      run: () => Promise.withResolvers<never>().promise,
    })
    .check({
      name: 'shelf',
      input: z.strictObject({}),
      data: z.strictObject({}),
      timeoutMs: 1000,
      run: () => Promise.resolve({}),
    })
    .feature({ name: 'greeting', summary: 'Greet a visitor', paths: ['src/**'] })
    .build();
}
