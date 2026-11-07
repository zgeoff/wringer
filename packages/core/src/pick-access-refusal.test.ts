import { expect, test } from 'bun:test';
import { pickAccessRefusal } from './pick-access-refusal.ts';

test.each([
  {
    name: 'a read on a read-only target',
    allowedTargets: undefined,
    access: 'read-only',
    effect: 'read',
    code: null,
  },
  {
    name: 'a write on a read-write target',
    allowedTargets: undefined,
    access: 'read-write',
    effect: 'write',
    code: null,
  },
  {
    name: 'a write on a read-only target',
    allowedTargets: undefined,
    access: 'read-only',
    effect: 'write',
    code: 'read-only',
  },
  {
    name: 'a command on a target it lists',
    allowedTargets: ['local'],
    access: 'read-write',
    effect: 'write',
    code: null,
  },
  {
    name: 'a command on a target it does not list',
    allowedTargets: ['staging'],
    access: 'read-only',
    effect: 'write',
    code: 'target-not-allowed',
  },
] as const)('it answers $name with $code', (row) => {
  const refusal = pickAccessRefusal({
    path: ['notes', 'add'],
    allowedTargets: row.allowedTargets,
    targetName: 'local',
    access: row.access,
    effect: row.effect,
    hint: 'local is read-only: reproduce it elsewhere.',
  });

  expect(refusal?.code ?? null).toBe(row.code);
});

test('it names the command, the target and its hint in a read-only refusal', () => {
  const refusal = pickAccessRefusal({
    path: ['notes', 'add'],
    allowedTargets: undefined,
    targetName: 'prod',
    access: 'read-only',
    effect: 'write',
    hint: 'prod is read-only: reproduce it on local.',
  });

  expect({ message: refusal?.message, hint: refusal?.hint }).toStrictEqual({
    message: '`notes add` is a write, and target prod is read-only.',
    hint: 'prod is read-only: reproduce it on local.',
  });
});
