import { dirname } from 'node:path';
import { formatLockOwner } from './format-lock-owner.ts';
import { parseLockOwner } from './parse-lock-owner.ts';
import { pickLockRecovery } from './pick-lock-recovery.ts';
import { WringerError } from './wringer-error.ts';

export interface FileLockOptions {
  readonly path: string;
  readonly timeoutMs: number;
}

export type FileLock = <T>(options: FileLockOptions, work: () => Promise<T>) => Promise<T>;

// Everything the lock reads or changes outside itself. `createFileOnce` resolves false when the
// file exists already, and `readText` resolves null when it does not.
export interface LockHost {
  readonly pid: number;
  readonly namespace: string;
  readonly createToken: () => string;
  readonly nowMs: () => number;
  readonly sleep: (durationMs: number) => Promise<void>;
  readonly probeProcess: (pid: number) => boolean;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly createFileOnce: (path: string, content: string) => Promise<boolean>;
  readonly readText: (path: string) => Promise<string | null>;
  readonly removeFile: (path: string) => Promise<void>;
}

const lockRetryMs = 20;

// The lock is a file that names its owner. Each turn either creates the file, or reads the one in
// place and acts on what `pickLockRecovery` makes of it, until the caller holds the lock or the
// timeout passes.
export function makeFileLock(host: LockHost): FileLock {
  return async (options, work) => {
    await host.createDirectory(dirname(options.path));

    const content = createOwnerContent(host);
    const deadline = host.nowMs() + options.timeoutMs;

    while (!(await takeLock(host, options.path, content))) {
      if (host.nowMs() > deadline) {
        throw new WringerError('environment', {
          message: `Another wringer command holds the lock ${options.path}.`,
          hint: 'Wait for the other command to end, then run this one again.',
        });
      }

      await host.sleep(lockRetryMs);
    }

    try {
      return await work();
    } finally {
      await removeLockHolding(host, options.path, content);
    }
  };
}

function createOwnerContent(host: LockHost): string {
  return formatLockOwner({ pid: host.pid, namespace: host.namespace, token: host.createToken() });
}

// One turn: true once this caller holds the lock.
async function takeLock(host: LockHost, path: string, content: string): Promise<boolean> {
  const created = await host.createFileOnce(path, content);

  if (created) {
    return true;
  }

  const held = await host.readText(path);

  const owner = held === null ? null : parseLockOwner(held);

  const recovery = pickLockRecovery({
    content: held,
    namespace: host.namespace,
    isOwnerAlive: owner !== null && host.probeProcess(owner.pid),
  });

  // `retry` and `wait` both end the turn here; the caller sleeps before the next one.
  if (recovery === 'clear-stale' && held !== null) {
    await removeStaleLock(host, path, held);
  }

  return false;
}

// Two callers can read the same stale content. Each must first take the claim, a lock named after
// that content, which only one of them holds at a time; it then removes the lock only if the lock
// still holds that content, so a lock that a new owner took meanwhile stays.
async function removeStaleLock(host: LockHost, path: string, stale: string): Promise<void> {
  const claim = `${path}.${Bun.hash(stale).toString(36)}.claim`;
  const claimant = createOwnerContent(host);

  const claimed = await takeLock(host, claim, claimant);

  if (!claimed) {
    return;
  }

  try {
    await removeLockHolding(host, path, stale);
  } finally {
    await removeLockHolding(host, claim, claimant);
  }
}

// Removes the lock only while it still holds `content`, so a lock someone else took stays.
async function removeLockHolding(host: LockHost, path: string, content: string): Promise<void> {
  const current = await host.readText(path);

  if (current === content) {
    await host.removeFile(path);
  }
}
