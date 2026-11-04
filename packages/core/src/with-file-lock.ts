import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isErrorCode } from './is-error-code.ts';
import { WringerError } from './wringer-error.ts';

export interface FileLockOptions {
  readonly path: string;
  readonly timeoutMs: number;
}

const lockRetryMs = 20;

// The lock is a file that holds its owner's PID and a token. A lock whose owner has died is stale,
// so the next caller removes it and tries again.
export async function withFileLock<T>(
  options: FileLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(options.path), { recursive: true });

  const content = `${process.pid} ${randomUUID()}`;
  const deadline = Date.now() + options.timeoutMs;

  while (!(await createLockFile(options.path, content))) {
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
    await removeOwnLock(options.path, content);
  }
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
    if (!isErrorCode(error, 'EEXIST')) {
      throw error;
    }
  } finally {
    await rm(draft, { force: true });
  }

  const stale = await readLockContent(path);

  if (stale !== null && !isProcessAlive(parseOwnerPID(stale))) {
    await removeStaleLock(path, stale);
  }

  return false;
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

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return isErrorCode(error, 'EPERM');
  }
}

function parseOwnerPID(content: string): number {
  const [pid = ''] = content.split(' ');

  return Number(pid);
}

// Two callers can read the same stale content. Each must first take the claim file named after that
// content, which `link` creates for one of them only, and check through it that the lock still
// holds that content; so the other never removes a lock a new owner has taken since.
async function removeStaleLock(path: string, stale: string): Promise<void> {
  const claim = `${path}.${Bun.hash(stale).toString(36)}.claim`;

  try {
    await link(path, claim);
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) {
      await removeAbandonedClaim(claim);

      return;
    }

    if (isErrorCode(error, 'ENOENT')) {
      return;
    }

    throw error;
  }

  try {
    const claimed = await readLockContent(claim);

    if (claimed === stale) {
      await rm(path, { force: true });
    }
  } finally {
    await rm(claim, { force: true });
  }
}

const claimStaleMs = 10_000;

// A caller that dies while it holds a claim leaves the claim behind; one older than any removal takes
// is abandoned.
async function removeAbandonedClaim(claim: string): Promise<void> {
  const info = await stat(claim).catch(() => null);

  if (info !== null && Date.now() - info.ctimeMs > claimStaleMs) {
    await rm(claim, { force: true });
  }
}

async function removeOwnLock(path: string, content: string): Promise<void> {
  const current = await readLockContent(path);

  if (current === content) {
    await rm(path, { force: true });
  }
}
