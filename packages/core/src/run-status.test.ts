import { expect, test } from 'bun:test';
import { canMoveRunStatus, findRunStatusMove } from './run-status.ts';

test.each([
  ['starting', 'running', true],
  ['starting', 'crashed', true],
  ['starting', 'ended', true],
  ['running', 'crashed', true],
  ['running', 'ended', true],
  ['crashed', 'ended', true],
  ['running', 'starting', false],
  ['crashed', 'running', false],
  ['ended', 'running', false],
  ['ended', 'crashed', false],
] as const)('#canMoveRunStatus answers a move from %s to %s with %p', (from, to, allowed) => {
  expect(canMoveRunStatus(from, to)).toBe(allowed);
});

test.each([
  ['launch-ready', 'running'],
  ['crashed', 'crashed'],
  ['run-ended', 'ended'],
  ['doctor-passed', null],
  ['envelope', null],
] as const)('#findRunStatusMove maps the %s event to %p', (eventType, status) => {
  expect(findRunStatusMove(eventType)).toBe(status);
});
