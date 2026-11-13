import { expect, test } from 'bun:test';
import { createWringer, local } from '@wringer/core';
import { z } from 'zod';
import { buildCLIWringer } from './build-cli-wringer.ts';
import { createDemoWringer } from './test-utils/create-demo-wringer.ts';

test('it adds the `lint` and `guide` commands beside the registry commands', () => {
  const wringer = buildCLIWringer(createDemoWringer(), '.claude/skills/verify');

  expect({
    lint: wringer.commands.get('lint')?.info.effect,
    guide: wringer.commands.get('guide')?.info.effect,
    up: wringer.commands.has('up'),
  }).toStrictEqual({ lint: 'read', guide: 'read', up: true });
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

  expect(() => buildCLIWringer(wringer, '.claude/skills/verify')).toThrow(
    'Two commands share the name `lint`.',
  );
});
