import { expect, test } from 'bun:test';
import { createDbWringer } from './create-db-wringer.ts';

test('it registers the local, prod, box and bench targets, the db command and the action', () => {
  const wringer = createDbWringer({ file: '/srv/shop.db', sqlite3: '/usr/bin/sqlite3' });

  expect({
    targets: [...wringer.targets.keys()],
    commands: ['db query', 'action sneak-insert'].map((path) => wringer.commands.has(path)),
  }).toStrictEqual({ targets: ['local', 'prod', 'box', 'bench'], commands: [true, true] });
});
