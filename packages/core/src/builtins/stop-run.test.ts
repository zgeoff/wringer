import { expect, test } from 'bun:test';
import { WringerError } from '../wringer-error.ts';
import { isSupervisorGone } from './stop-run.ts';

test.each([
  { name: 'a refused connection', error: new WringerError('not-running'), gone: true },
  { name: 'a call past its deadline', error: new WringerError('timeout'), gone: false },
  { name: 'a closed socket', error: new WringerError('environment'), gone: false },
  { name: 'a plain error', error: new Error('The store kept its lock.'), gone: false },
])('#isSupervisorGone reads $name as a gone supervisor: $gone', (row) => {
  expect(isSupervisorGone(row.error)).toBe(row.gone);
});
