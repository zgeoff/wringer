import { expect, test } from 'bun:test';
import { pickRunReplacement } from './start-run.ts';

test.each([
  { status: undefined, alive: false, restart: false, replacement: 'start' },
  { status: 'ended', alive: false, restart: false, replacement: 'start' },
  { status: 'crashed', alive: false, restart: true, replacement: 'start' },
  { status: 'running', alive: true, restart: false, replacement: 'reuse' },
  { status: 'running', alive: true, restart: true, replacement: 'stop' },
  { status: 'starting', alive: true, restart: false, replacement: 'stop' },
  { status: 'running', alive: false, restart: false, replacement: 'mark-crashed' },
  { status: 'starting', alive: false, restart: false, replacement: 'mark-crashed' },
] as const)(
  '#pickRunReplacement picks $replacement for a $status run, alive $alive, restart $restart',
  (row) => {
    expect(pickRunReplacement({ status: row.status, alive: row.alive, restart: row.restart })).toBe(
      row.replacement,
    );
  },
);
