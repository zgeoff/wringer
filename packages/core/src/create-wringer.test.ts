import { expect, expectTypeOf, test } from 'bun:test';
import { z } from 'zod';
import { bindDrivers } from './bind-drivers.ts';
import { createWringer } from './create-wringer.ts';
import { defineDriver } from './define-driver.ts';
import { local } from './local.ts';
import { notes } from './test-utils/notes-driver.ts';
import { WringerError } from './wringer-error.ts';

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

test('it refuses a driver command that declares it needs no run', () => {
  const shelf = defineDriver({
    name: 'shelf',
    options: z.strictObject({}),
    targetConfig: z.strictObject({}),
    services: {},
    client: () => ({}),
    commands: (command) => [
      command({
        path: ['shelf', 'count'],
        summary: 'Count the shelf',
        args: z.strictObject({}),
        data: z.strictObject({}),
        effect: 'read',
        needsRun: false,
        run: () => Promise.resolve({}),
      }),
    ],
  });

  const builder = createWringer({ name: 'shop' })
    .use(shelf({}))
    .target('local', { mode: 'attach', access: 'read-write', host: local() });

  expect(() => builder.build()).toThrow(
    "The driver command `shelf count` needs a run, because its client calls the run's services.",
  );
});

test('it refuses two drivers of one name', () => {
  const builder = createWringer({ name: 'shop' })
    .use(notes({ prefix: 'a' }))
    .use(notes({ prefix: 'b' }))
    .target('local', { mode: 'attach', access: 'read-write', host: local() });

  expect(() => builder.build()).toThrow('Two drivers are named `notes`.');
});

test('it refuses a repo check named revision when an attach target declares revision', () => {
  const builder = createWringer({ name: 'shop' })
    .target('staging', {
      mode: 'attach',
      access: 'read-only',
      host: local(),
      revision: () => '5e1d0a7',
    })
    .check({
      name: 'revision',
      timeoutMs: 1000,
      input: z.strictObject({}),
      data: z.strictObject({}),
      run: () => Promise.resolve({}),
    });

  expect(() => builder.build()).toThrow(
    expect.objectContaining({ code: 'usage', message: expect.stringContaining('`revision`') }),
  );
});

test('it accepts a repo check named revision when no target declares revision', () => {
  const builder = createWringer({ name: 'shop' })
    .target('staging', { mode: 'attach', access: 'read-only', host: local() })
    .check({
      name: 'revision',
      timeoutMs: 1000,
      input: z.strictObject({}),
      data: z.strictObject({}),
      run: () => Promise.resolve({}),
    });

  expect(builder.build().checks.map((check) => check.name)).toStrictEqual(['revision']);
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

test('it collects the ignore globs of each `ignore` call in order', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .ignore('docs/**', '**/*.md')
    .ignore('.github/**')
    .build();

  expect(wringer.ignore).toStrictEqual(['docs/**', '**/*.md', '.github/**']);
});

test('it ignores no path unless the repo lists some', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .build();

  expect(wringer.ignore).toStrictEqual([]);
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

test('it collects the shared globs of each `shared` call in order, and no other path', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .shared('package.json', 'bun.lock')
    .shared('verify/**')
    .build();

  expect(wringer.shared).toStrictEqual(['package.json', 'bun.lock', 'verify/**']);
});

test('it shares no path unless the repo lists some', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .build();

  expect(wringer.shared).toStrictEqual([]);
});

test('it refuses a feature name of 65 characters', () => {
  const builder = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .feature({ name: 'a'.repeat(65), summary: 'Pay', paths: ['src/**'] });

  expect(() => builder.build()).toThrowWithMessage(
    WringerError,
    /The feature name `a{65}` is longer than 64 characters/u,
  );
});

test('it refuses a target name of 65 characters', () => {
  const builder = createWringer({ name: 'shop' }).target('t'.repeat(65), {
    mode: 'attach',
    access: 'read-write',
    host: local(),
  });

  expect(() => builder.build()).toThrowWithMessage(
    WringerError,
    /The target name `t{65}` is longer than 64 characters/u,
  );
});

test.each([
  ['65 characters', 'r'.repeat(65)],
  ['no characters', ''],
])('it refuses a registry name of %s', (_label, name) => {
  const builder = createWringer({ name }).target('local', {
    mode: 'attach',
    access: 'read-write',
    host: local(),
  });

  expect(() => builder.build()).toThrowWithMessage(
    WringerError,
    /The registry name `r*` must hold 1 to 64 characters/u,
  );
});

test('it accepts a feature name of 64 characters', () => {
  const wringer = createWringer({ name: 'shop' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .feature({ name: 'a'.repeat(64), summary: 'Pay', paths: ['src/**'] })
    .build();

  expect(wringer.features.map((feature) => feature.name)).toStrictEqual(['a'.repeat(64)]);
});
