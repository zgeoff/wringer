import { expect, test } from 'bun:test';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { pickCommandName } from './pick-command-name.ts';

test.each([
  { argv: [], name: 'help' },
  { argv: ['status', '--target', 'prod'], name: 'status' },
  { argv: ['action', 'greet', '--name', 'secret-name'], name: 'action.greet' },
  { argv: ['label', 'shelf-a', 'apple', '--label', 'ripe'], name: 'label' },
  { argv: ['teleport', 'somewhere'], name: 'unknown' },
])('it names $name for argv $argv', (row) => {
  expect(pickCommandName(createDemoWringer(), row.argv)).toBe(row.name);
});
