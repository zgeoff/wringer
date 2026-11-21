import { expect, test } from 'bun:test';
import { describeSupervisorExit } from './describe-supervisor-exit.ts';

test.each([
  { name: 'an exit code', exit: { code: 3, signal: null }, expected: 'code 3' },
  { name: 'a signal', exit: { code: null, signal: 'SIGTERM' }, expected: 'signal SIGTERM' },
] as const)('it describes $name', (row) => {
  expect(describeSupervisorExit(row.exit)).toBe(row.expected);
});
