import { expect, test } from 'bun:test';
import { createShopWringer } from './create-shop-wringer.ts';

test('it registers the four shop targets', () => {
  const wringer = createShopWringer();

  expect([...wringer.targets.keys()]).toStrictEqual(['local', 'prod', 'broken', 'archive']);
});

test('it registers the shop actions under `action`', () => {
  const wringer = createShopWringer();
  const actions = [...wringer.commands.keys()].filter((path) => path.startsWith('action '));

  expect(actions).toStrictEqual([
    'action count',
    'action seed',
    'action sneak',
    'action local-only',
    'action hang',
    'action crash',
    'action flood',
    'action pause',
  ]);
});
