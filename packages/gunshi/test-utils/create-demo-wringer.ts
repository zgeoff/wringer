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

// A repo's verify CLI for the adapter's tests: a launch target `local` whose app is a shell that
// prints one ready line, a read-only attach target `prod`, a read action with every flag type, a
// repo command with two positionals, and a doctor check that passes.
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
