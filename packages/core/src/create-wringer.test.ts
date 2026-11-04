import { expect, expectTypeOf, test } from 'bun:test';
import { z } from 'zod';
import { notes } from '../test-utils/notes-driver.ts';
import { bindDrivers } from './bind-drivers.ts';
import { createWringer } from './create-wringer.ts';
import { local } from './local.ts';

test('it registers the built-ins, the driver commands and each action under `action`', () => {
  const wringer = createWringer({ name: 'shop' })
    .use(notes({}))
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .action({
      name: 'seed',
      summary: 'Seed',
      effect: 'write',
      input: z.strictObject({}),
      data: z.strictObject({}),
      run: () => Promise.resolve({}),
    })
    .build();

  expect([...wringer.commands.keys()]).toStrictEqual([
    'up',
    'attach',
    'down',
    'detach',
    'status',
    'use',
    'features',
    'done',
    'report',
    'gate',
    'doctor',
    'exec',
    'notes add',
    'notes list',
    'action seed',
  ]);
});

test('it refuses a repo command whose path a built-in already holds', () => {
  const builder = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .command({
      path: ['status'],
      summary: 'Another status',
      args: z.strictObject({}),
      data: z.strictObject({}),
      run: () => Promise.resolve({}),
    });

  expect(() => builder.build()).toThrow('Two commands share the name `status`.');
});

test('it refuses a CLI with no target', () => {
  expect(() => createWringer({ name: 'shop' }).build()).toThrow(
    'A wringer CLI needs at least one target.',
  );
});

test('it keeps the state folder in .wringer unless the repo names another', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .build();

  expect(wringer.stateDir).toBe('.wringer');
});

test('it types an action against the drivers the repo bound', () => {
  const shop = bindDrivers([notes({})] as const);

  const action = shop.defineAction({
    name: 'count',
    summary: 'Count',
    effect: 'read',
    input: z.strictObject({}),
    data: z.strictObject({ count: z.number() }),
    run: async (_input, ctx) => {
      expectTypeOf(ctx.drivers).not.toHaveProperty('payments');

      const listed = await ctx.drivers.notes.list(null);

      return { count: listed.length };
    },
  });

  expect(action.name).toBe('count');
});

test('it refuses a launch target that carries attach-only endpoints, at compile time', () => {
  const shop = bindDrivers([notes({})] as const);

  // @ts-expect-error -- a launch target takes no endpoints
  const target = shop.defineTarget({
    mode: 'launch',
    access: 'read-write',
    host: local(),
    launch: () => ({ command: ['true'], ready: () => ({}) }),
    endpoints: () => ({}),
  });

  expect(target.mode).toBe('launch');
});
