import { expect, test } from 'bun:test';
import { createShopWringer } from './create-shop-wringer.ts';

test('it registers the five shop targets', () => {
  const wringer = createShopWringer();

  expect([...wringer.targets.keys()]).toStrictEqual([
    'local',
    'prod',
    'broken',
    'slow',
    'archive',
    'constructor',
  ]);
});

test('it registers the stock and restock repo commands', () => {
  const wringer = createShopWringer();

  expect([wringer.commands.has('stock'), wringer.commands.has('restock')]).toStrictEqual([
    true,
    true,
  ]);
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
    'action receipt',
    'action crash',
    'action hoard',
    'action tally',
    'action flood',
    'action pause',
  ]);
});
