import { expect, test } from 'bun:test';
import { pickMCPEffect } from './pick-mcp-effect.ts';

test.each([
  { name: 'a tool in readTools', server: 'atc', tool: 'sessions_list', effect: 'read' },
  { name: 'a tool missing from readTools', server: 'atc', tool: 'session_stop', effect: 'write' },
  {
    name: 'a read tool of another server',
    server: 'local',
    tool: 'sessions_list',
    effect: 'write',
  },
  { name: 'a call with no server among several', server: undefined, tool: 'x', effect: 'read' },
  {
    name: 'a call to a server the target does not name',
    server: 'other',
    tool: 'x',
    effect: 'read',
  },
])('#pickMCPEffect returns $effect for $name', (row) => {
  const servers = { atc: { readTools: ['sessions_list'] }, local: { readTools: [] } };

  expect(pickMCPEffect(servers, row.server, row.tool)).toBe(row.effect);
});
