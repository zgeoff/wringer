import { expect, test } from 'bun:test';
import { createBrowserWringer } from './create-browser-wringer.ts';

test('it builds the local and prod targets with the browser driver and the sneak-order action', () => {
  const wringer = createBrowserWringer('http://127.0.0.1:4000/');

  expect({
    targets: [...wringer.targets.keys()],
    access: [...wringer.targets.values()].map((target) => target.access),
    sneakOrder: wringer.commands.has('action sneak-order'),
  }).toStrictEqual({
    targets: ['local', 'prod'],
    access: ['read-write', 'read-only'],
    sneakOrder: true,
  });
});
