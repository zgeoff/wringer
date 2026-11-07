import { expect, test } from 'bun:test';
import { pickContextTarget } from './pick-context-target.ts';

test.each([
  {
    name: 'the session target first',
    session: 'prod',
    saved: 'local',
    key: 'status',
    picked: 'prod',
  },
  {
    name: 'the saved target with no session target',
    session: undefined,
    saved: 'prod',
    key: 'status',
    picked: 'prod',
  },
  {
    name: 'the first target with neither',
    session: undefined,
    saved: undefined,
    key: 'status',
    picked: 'local',
  },
  {
    name: 'a saved target the registry dropped, for most commands',
    session: undefined,
    saved: 'gone',
    key: 'status',
    picked: 'gone',
  },
  {
    name: 'the first target for `use` when the registry dropped the saved one',
    session: undefined,
    saved: 'gone',
    key: 'use',
    picked: 'local',
  },
  {
    name: 'the saved target for `use` while the registry has it',
    session: undefined,
    saved: 'prod',
    key: 'use',
    picked: 'prod',
  },
])('it picks $name', (row) => {
  const picked = pickContextTarget({
    targetNames: ['local', 'prod'],
    sessionTarget: row.session,
    savedTarget: row.saved,
    commandKey: row.key,
  });

  expect(picked).toBe(row.picked);
});
