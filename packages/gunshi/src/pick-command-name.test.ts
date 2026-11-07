import { expect, test } from 'bun:test';
import { pickCommandName } from './pick-command-name.ts';

test.each([
  { commandPath: [], argv: [], name: 'help' },
  { commandPath: ['status'], argv: ['status', '--target', 'prod'], name: 'status' },
  {
    commandPath: ['action', 'greet'],
    argv: ['action', 'greet', '--name', 'Ines'],
    name: 'action.greet',
  },
  { commandPath: [], argv: ['teleport', 'somewhere'], name: 'unknown' },
])('it names $name for the command path $commandPath', (row) => {
  expect(pickCommandName(row.commandPath, row.argv)).toBe(row.name);
});
