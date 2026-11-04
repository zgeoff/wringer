import { expect, mock, test } from 'bun:test';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { buildGunshiCommands } from './build-gunshi-commands.ts';
import type { Invocation } from './build-gunshi-commands.ts';

test('it nests each command under the words of its path', () => {
  const commands = buildGunshiCommands(
    createDemoWringer(),
    mock<(invocation: Invocation) => void>(),
  );

  expect(commands['action']?.subCommands).toStrictEqual({
    greet: expect.objectContaining({ name: 'greet', description: 'Greet someone [read]' }),
  });
});

test('it marks a command with no declared effect as a write', () => {
  const commands = buildGunshiCommands(
    createDemoWringer(),
    mock<(invocation: Invocation) => void>(),
  );

  expect(commands['exec']?.description).toEndWith('[write]');
});

test('it gives every command the global flags', () => {
  const commands = buildGunshiCommands(
    createDemoWringer(),
    mock<(invocation: Invocation) => void>(),
  );

  expect(Object.keys(commands['status']?.args ?? {})).toStrictEqual([
    'target',
    'feature',
    'timeoutMs',
    'human',
    'json',
  ]);
});
