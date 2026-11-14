import { expect, test } from 'bun:test';
import { createTerminalWringer } from './create-terminal-wringer.ts';

function setupTest() {
  return { wringer: createTerminalWringer() };
}

test('it builds a read-write local target and a read-only prod target with the terminal commands', () => {
  const ctx = setupTest();

  expect({
    targets: [...ctx.wringer.targets.keys()],
    access: [...ctx.wringer.targets.values()].map((target) => target.access),
    commands: [...ctx.wringer.commands.keys()].filter((path) => path.startsWith('terminal ')),
  }).toStrictEqual({
    targets: ['local', 'prod'],
    access: ['read-write', 'read-only'],
    commands: [
      'terminal start',
      'terminal type',
      'terminal press',
      'terminal wait',
      'terminal screen',
      'terminal stop',
      'terminal list',
    ],
  });
});
