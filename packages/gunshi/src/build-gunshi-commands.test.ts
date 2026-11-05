import { expect, mock, test } from 'bun:test';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { buildGunshiCommands } from './build-gunshi-commands.ts';
import type { InvokeResult } from './build-gunshi-commands.ts';
import { extraWordsArg } from './build-positional-args.ts';

test('it nests each command under the words of its path', () => {
  const commands = buildGunshiCommands(createDemoWringer(), mock<(result: InvokeResult) => void>());

  expect(commands['action']?.subCommands).toStrictEqual({
    greet: expect.objectContaining({ name: 'greet', description: 'Greet someone [read]' }),
  });
});

test('it marks a command with no declared effect as a write', () => {
  const commands = buildGunshiCommands(createDemoWringer(), mock<(result: InvokeResult) => void>());

  expect(commands['exec']?.description).toEndWith('[write]');
});

test('it marks a command that decides its effect by its arguments as a read or a write', () => {
  const commands = buildGunshiCommands(createDemoWringer(), mock<(result: InvokeResult) => void>());

  expect(commands['ship']?.description).toBe('Ship an order by post or for pickup [read or write]');
});

test('it gives every command the global flags and a hidden home for extra words', () => {
  const commands = buildGunshiCommands(createDemoWringer(), mock<(result: InvokeResult) => void>());

  expect(Object.keys(commands['status']?.args ?? {})).toStrictEqual([
    'target',
    'feature',
    'timeoutMs',
    'human',
    'json',
    extraWordsArg,
  ]);
});

test('it declares a command’s positionals to gunshi in order', () => {
  const commands = buildGunshiCommands(createDemoWringer(), mock<(result: InvokeResult) => void>());

  const positionals = Object.entries(commands['label']?.args ?? {}).flatMap(([name, schema]) =>
    schema.type === 'positional' && schema.hidden !== true ? [name] : [],
  );

  expect(positionals).toStrictEqual(['shelf', 'item']);
});
