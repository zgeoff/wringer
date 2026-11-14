import { expect, test } from 'bun:test';
import { pickServerName } from './pick-server-name.ts';

test('#pickServerName picks the only server when none is requested', () => {
  expect(pickServerName(['atc'], undefined)).toStrictEqual({ kind: 'picked', name: 'atc' });
});

test('#pickServerName refuses an unnamed pick among several servers and lists them', () => {
  expect(pickServerName(['atc', 'local'], undefined)).toStrictEqual({
    kind: 'refused',
    message: 'The target names more than one MCP server.',
    hint: 'Pass --server with one of: atc, local.',
  });
});

test('#pickServerName picks the requested server', () => {
  expect(pickServerName(['atc', 'local'], 'local')).toStrictEqual({
    kind: 'picked',
    name: 'local',
  });
});

test('#pickServerName refuses a server the target does not name', () => {
  expect(pickServerName(['atc'], 'other')).toStrictEqual({
    kind: 'refused',
    message: 'The target has no MCP server other.',
    hint: 'Name one of: atc.',
  });
});
