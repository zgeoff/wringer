import { parseLockOwner } from './parse-lock-owner.ts';

export interface LockObservation {
  readonly content: string | null;
  readonly namespace: string;
  readonly isOwnerAlive: boolean;
}

// `retry` means the lock went away, `wait` that its owner may still use it, and `clear-stale` that
// the caller removes it before the next turn.
export type LockRecovery = 'retry' | 'wait' | 'clear-stale';

// An owner in another PID namespace counts as alive, because its PID means nothing here. A lock
// file holds its whole content from its first moment, so content that names no owner came from no
// live wringer command.
export function pickLockRecovery(observation: LockObservation): LockRecovery {
  if (observation.content === null) {
    return 'retry';
  }

  const owner = parseLockOwner(observation.content);

  if (owner === null) {
    return 'clear-stale';
  }

  if (owner.namespace !== observation.namespace || observation.isOwnerAlive) {
    return 'wait';
  }

  return 'clear-stale';
}
