import { expect, test } from 'bun:test';
import { createBrowserWringer } from './create-browser-wringer.ts';

test('it builds the local and prod targets with the browser driver and the order actions', () => {
  const wringer = createBrowserWringer('http://127.0.0.1:4000/');

  expect({
    targets: [...wringer.targets.keys()],
    access: [...wringer.targets.values()].map((target) => target.access),
    actions: [...wringer.commands.keys()].filter((path) => path.startsWith('action ')),
  }).toStrictEqual({
    targets: ['local', 'prod'],
    access: ['read-write', 'read-only'],
    actions: ['action sneak-order', 'action script-order'],
  });
});
