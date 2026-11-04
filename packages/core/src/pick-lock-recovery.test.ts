import { expect, test } from 'bun:test';
import { pickLockRecovery } from './pick-lock-recovery.ts';

test.each([
  { name: 'a lock that is gone', content: null, isOwnerAlive: false, recovery: 'retry' },
  { name: 'an empty lock', content: '', isOwnerAlive: false, recovery: 'clear-stale' },
  { name: 'a lock with no owner', content: 'beds', isOwnerAlive: false, recovery: 'clear-stale' },
  {
    name: 'a dead owner in this namespace',
    content: '4100 4026531836 a1b2',
    isOwnerAlive: false,
    recovery: 'clear-stale',
  },
  {
    name: 'a live owner in this namespace',
    content: '4100 4026531836 a1b2',
    isOwnerAlive: true,
    recovery: 'wait',
  },
  {
    name: 'an owner in another namespace',
    content: '4100 4026532001 a1b2',
    isOwnerAlive: false,
    recovery: 'wait',
  },
] as const)('it answers $name with $recovery', (row) => {
  const recovery = pickLockRecovery({
    content: row.content,
    namespace: '4026531836',
    isOwnerAlive: row.isOwnerAlive,
  });

  expect(recovery).toBe(row.recovery);
});
