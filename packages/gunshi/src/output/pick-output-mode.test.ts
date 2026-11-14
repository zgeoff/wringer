import { expect, test } from 'bun:test';
import { parseArgs } from 'gunshi';
import { pickOutputMode } from './pick-output-mode.ts';

test.each([
  { name: 'json for a pipe', argv: [], isTTY: false, isAgent: false, mode: 'json' },
  {
    name: 'human for a person at a terminal',
    argv: [],
    isTTY: true,
    isAgent: false,
    mode: 'human',
  },
  { name: 'json for an agent at a terminal', argv: [], isTTY: true, isAgent: true, mode: 'json' },
  {
    name: 'human for --human on a pipe',
    argv: ['--human'],
    isTTY: false,
    isAgent: false,
    mode: 'human',
  },
  {
    name: 'json for --json at a terminal',
    argv: ['--json'],
    isTTY: true,
    isAgent: false,
    mode: 'json',
  },
  {
    name: 'json for --json=true at a terminal',
    argv: ['status', '--json=true'],
    isTTY: true,
    isAgent: false,
    mode: 'json',
  },
  {
    name: 'human for --human=true on a pipe',
    argv: ['status', '--human=true'],
    isTTY: false,
    isAgent: false,
    mode: 'human',
  },
  {
    name: 'the last of --json and --human',
    argv: ['--human', '--json'],
    isTTY: false,
    isAgent: false,
    mode: 'json',
  },
  {
    name: 'json for --human after `--`',
    argv: ['exec', '--', 'tool', '--human'],
    isTTY: false,
    isAgent: false,
    mode: 'json',
  },
] as const)('it picks $name', (row) => {
  expect(
    pickOutputMode({ tokens: parseArgs([...row.argv]), isTTY: row.isTTY, isAgent: row.isAgent }),
  ).toBe(row.mode);
});
