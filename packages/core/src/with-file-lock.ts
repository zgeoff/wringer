import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isErrorCode } from './is-error-code.ts';
import { WringerError } from './wringer-error.ts';

export interface FileLockOptions {
  readonly path: string;
  readonly timeoutMs: number;
}

const lockRetryMs = 20;

// The lock is a file created with O_EXCL that holds the owner's PID. A lock whose owner has died is
// stale, so the next caller removes it and tries again.
export async function withFileLock<T>(
  options: FileLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(options.path), { recursive: true });

  const deadline = Date.now() + options.timeoutMs;

  while (!(await createLockFile(options.path))) {
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
    await rm(options.path, { force: true });
  }
}

async function createLockFile(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx');

    await handle.writeFile(String(process.pid));
    await handle.close();

    return true;
  } catch (error) {
    if (!isErrorCode(error, 'EEXIST')) {
      throw error;
    }
  }

  // The owner creates the file before it writes its PID, so an empty file is a live lock.
  const text = await readFile(path, 'utf8').catch(() => '');

  const owner = Number(text);

  if (text !== '' && Number.isInteger(owner) && !isProcessAlive(owner)) {
    await rm(path, { force: true });
  }

  return false;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return isErrorCode(error, 'EPERM');
  }
}
