import type { LockOwner } from './parse-lock-owner.ts';

export function formatLockOwner(owner: LockOwner): string {
  return `${owner.pid} ${owner.namespace} ${owner.token}`;
}
