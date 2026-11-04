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

// A repo's verify CLI for the adapter's tests: a launch target `local` whose app is a shell that
// prints one ready line, a read-only attach target `prod`, and a read action with every flag type.
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
    .feature({ name: 'greeting', summary: 'Greet a visitor', paths: ['src/**'] })
    .build();
}
