import { expect, test } from 'bun:test';
import { buildLaunchGuard } from './build-launch-guard.ts';

test.each([
  {
    host: 'a host with setpriv',
    setprivPath: '/usr/bin/setpriv',
    guard: ['setpriv', '--pdeathsig', 'KILL', '--'],
  },
  { host: 'a host without setpriv', setprivPath: null, guard: [] },
])('it builds the launch guard for $host', (row) => {
  expect(buildLaunchGuard(row.setprivPath)).toStrictEqual(row.guard);
});
