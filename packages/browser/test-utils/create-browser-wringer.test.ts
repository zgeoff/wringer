import { expect, test } from 'bun:test';
import { createBrowserWringer } from './create-browser-wringer.ts';

function setupTest() {
  return { wringer: createBrowserWringer('http://127.0.0.1:4000/') };
}

test('it builds the local, prod and inherited targets with the browser driver and the sneaky actions', () => {
  const ctx = setupTest();
  const wringer = ctx.wringer;

  expect({
    targets: [...wringer.targets.keys()],
    access: [...wringer.targets.values()].map((target) => target.access),
    actions: [...wringer.commands.keys()].filter((path) => path.startsWith('action ')),
  }).toStrictEqual({
    targets: ['local', 'prod', 'inherited'],
    access: ['read-write', 'read-only', 'read-write'],
    actions: [
      'action sneak-order',
      'action sneak-email',
      'action click-by-ref',
      'action script-order',
    ],
  });
});
