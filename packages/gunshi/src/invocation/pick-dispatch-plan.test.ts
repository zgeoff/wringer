import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { pickDispatchPlan } from './pick-dispatch-plan.ts';

test('it dispatches an invocation inside a repo with that repo as its root', () => {
  const invocation = {
    path: ['action', 'greet'],
    raw: { name: 'Ines' },
    globals: { target: 'local' },
  };

  expect(pickDispatchPlan(invocation, '/srv/shop')).toStrictEqual({
    kind: 'dispatch',
    root: '/srv/shop',
    invocation,
  });
});

test('it refuses an invocation outside a repo with the root error and its exit code', () => {
  const plan = pickDispatchPlan(
    {
      path: ['action', 'greet'],
      raw: { name: 'Ines' },
      globals: { target: 'local' },
    },
    new WringerError('environment', { message: 'The folder is not inside a git worktree.' }),
  );

  expect(plan).toStrictEqual({
    kind: 'refuse',
    envelope: expect.objectContaining({
      command: 'action.greet',
      ok: false,
      error: {
        code: 'environment',
        message: 'The folder is not inside a git worktree.',
        hint: null,
      },
    }),
    exitCode: 4,
  });
});
