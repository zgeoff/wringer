import { expect, test } from 'bun:test';
import { notes } from './notes.ts';

test('it declares the add and list commands and the store service', () => {
  const driver = notes({});

  expect({
    commands: driver.commands.map((command) => command.path.join(' ')),
    services: driver.serviceNames,
  }).toStrictEqual({ commands: ['notes add', 'notes list'], services: ['store'] });
});

test('it refuses a target config with an unknown key', () => {
  const driver = notes({});
  const result = driver.configure({ grants: [] });

  expect(result.ok).toBe(false);
});
