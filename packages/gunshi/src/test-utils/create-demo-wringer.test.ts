import { expect, test } from 'bun:test';
import { createDemoWringer } from './create-demo-wringer.ts';

test('it registers a launch target, a read-only attach target and the greet action', () => {
  const wringer = createDemoWringer();

  expect({
    targets: [...wringer.targets].map(([name, target]) => [name, target.mode, target.access]),
    greet: wringer.commands.get('action greet')?.info.effect,
  }).toStrictEqual({
    targets: [
      ['local', 'launch', 'read-write'],
      ['prod', 'attach', 'read-only'],
    ],
    greet: 'read',
  });
});
