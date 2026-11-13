import { expect, test } from 'bun:test';
import { createWringer, local } from '@wringer/core';
import { z } from 'zod';
import { buildLintedWringer } from './build-linted-wringer.ts';
import { createDemoWringer } from './test-utils/create-demo-wringer.ts';

test('it adds the `lint` command beside the registry commands', () => {
  const wringer = buildLintedWringer(createDemoWringer(), '.claude/skills/verify');

  expect({
    lint: wringer.commands.get('lint')?.info.effect,
    up: wringer.commands.has('up'),
  }).toStrictEqual({ lint: 'read', up: true });
});

test('it refuses a registry that registers its own `lint` command', () => {
  const wringer = createWringer({ name: 'kettle' })
    .target('local', {
      mode: 'attach',
      access: 'read-write',
      host: local(),
      endpoints: () => ({ web: 'http://127.0.0.1:4100' }),
    })
    .command({
      path: ['lint'],
      summary: 'Lint the kettle',
      args: z.strictObject({}),
      data: z.null(),
      effect: 'read',
      needsRun: false,
      run: () => Promise.resolve(null),
    })
    .build();

  expect(() => buildLintedWringer(wringer, '.claude/skills/verify')).toThrow(
    'Two commands share the name `lint`.',
  );
});
