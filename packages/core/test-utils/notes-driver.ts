import { z } from 'zod';
import { defineDriver } from '../src/define-driver.ts';

const noteSchema = z.strictObject({ text: z.string().min(1) });
const textsSchema = z.array(z.string());
const grantsSchema = z.strictObject({ add: z.array(z.string()) });

// A driver for tests: a note store that lives in the run's supervisor as a service, a client whose
// `add` is a write unless the target grants that text, and two commands over the client.
export const notes = defineDriver({
  name: 'notes',
  options: z.strictObject({ prefix: z.string().default('') }),
  targetConfig: z.strictObject({
    readOnly: grantsSchema.optional(),
  }),
  services: {
    store: {
      start: () => {
        const items: string[] = [];

        return Promise.resolve({
          methods: {
            add: (args: unknown) => Promise.resolve(items.push(noteSchema.parse(args).text)),
            list: () => Promise.resolve([...items]),
          },
          stop: () => Promise.resolve(),
        });
      },
    },
  },
  client: (session, fence) => ({
    list: fence({
      effect: () => 'read',
      describe: () => 'notes list',
      run: async (args: null) => {
        const items = await session.service('store').call('list', args);

        return textsSchema.parse(items);
      },
    }),
    add: fence({
      effect: (args: z.infer<typeof noteSchema>) =>
        session.config.readOnly?.add.includes(args.text) === true ? 'read' : 'write',
      describe: (args) => `notes add ${args.text}`,
      run: async (args) => {
        const count = await session.service('store').call('add', {
          text: `${session.options.prefix}${args.text}`,
        });

        return z.number().parse(count);
      },
    }),
  }),
  commands: (command) => [
    command({
      path: ['notes', 'add'],
      summary: 'Add a note',
      args: noteSchema,
      positionals: ['text'],
      data: z.strictObject({ count: z.number() }),
      decideEffect: (args, config) =>
        config.readOnly?.add.includes(args.text) === true ? 'read' : 'write',
      run: async (args, ctx) => ({ count: await ctx.client.add(args) }),
    }),
    command({
      path: ['notes', 'list'],
      summary: 'List the notes',
      args: z.strictObject({}),
      data: z.strictObject({ notes: textsSchema }),
      effect: 'read',
      run: async (_args, ctx) => ({ notes: await ctx.client.list(null) }),
    }),
  ],
  checks: [
    {
      name: 'store',
      timeoutMs: 1000,
      run: async (ctx) => {
        await ctx.client.list(null);
      },
    },
  ],
});
