import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatLockOwner } from './format-lock-owner.ts';
import { isErrorCode } from './is-error-code.ts';
import { parseLockOwner } from './parse-lock-owner.ts';
import { pickLockRecovery } from './pick-lock-recovery.ts';
import { probeProcess } from './probe-process.ts';
import { readPIDNamespace } from './read-pid-namespace.ts';
import { WringerError } from './wringer-error.ts';

export interface FileLockOptions {
  readonly path: string;
  readonly timeoutMs: number;
}

export type FileLock = <T>(options: FileLockOptions, work: () => Promise<T>) => Promise<T>;

const lockRetryMs = 20;

// The lock is a file that names its owner. Each turn either creates the file, or reads the one in
// place and acts on what `pickLockRecovery` makes of it, until the caller holds the lock or the
// timeout passes.
export async function withFileLock<T>(
  options: FileLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(options.path), { recursive: true });

  const namespace = readPIDNamespace();
  const content = formatLockOwner({ pid: process.pid, namespace, token: randomUUID() });
  const deadline = Date.now() + options.timeoutMs;

  while (!(await takeLock(options.path, content, namespace))) {
    if (Date.now() > deadline) {
      throw new WringerError('environment', {
        message: `Another wringer command holds the lock ${options.path}.`,
        hint: 'Wait for the other command to end, then run this one again.',
      });
    }

    await Bun.sleep(lockRetryMs);
  }

  try {
    return await work();
  } finally {
    await removeLockHolding(options.path, content);
  }
}

// One turn: true once this caller holds the lock.
async function takeLock(path: string, content: string, namespace: string): Promise<boolean> {
  const created = await createLockFile(path, content);

  if (created) {
    return true;
  }

  const held = await readLockContent(path);

  const owner = held === null ? null : parseLockOwner(held);

  const recovery = pickLockRecovery({
    content: held,
    namespace,
    isOwnerAlive: owner !== null && probeProcess(owner.pid),
  });

  // `retry` and `wait` both end the turn here; the caller sleeps before the next one.
  if (recovery === 'clear-stale' && held !== null) {
    await removeStaleLock(path, held, namespace);
  }

  return false;
}

// The content goes into a file of its own, then `link` puts it at the lock path in one step, so a
// lock file is never seen empty, and a crash leaves either no lock or a whole one.
async function createLockFile(path: string, content: string): Promise<boolean> {
  const draft = `${path}.${randomUUID()}.draft`;

  await writeFile(draft, content);

  try {
    await link(draft, path);

    return true;
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) {
      return false;
    }

    throw error;
  } finally {
    await rm(draft, { force: true });
  }
}

async function readLockContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}

// Two callers can read the same stale content. Each must first take the claim, a lock named after
// that content, which only one of them holds at a time; it then removes the lock only if the lock
// still holds that content, so a lock that a new owner took meanwhile stays.
async function removeStaleLock(path: string, stale: string, namespace: string): Promise<void> {
  const claim = `${path}.${Bun.hash(stale).toString(36)}.claim`;
  const claimant = formatLockOwner({ pid: process.pid, namespace, token: randomUUID() });

  const claimed = await takeLock(claim, claimant, namespace);

  if (!claimed) {
    return;
  }

  try {
    await removeLockHolding(path, stale);
  } finally {
    await removeLockHolding(claim, claimant);
  }
}

// Removes the lock only while it still holds `content`, so a lock someone else took stays.
async function removeLockHolding(path: string, content: string): Promise<void> {
  const current = await readLockContent(path);

  if (current === content) {
    await rm(path, { force: true });
  }
}
