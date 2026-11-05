import { randomUUID } from 'node:crypto';
import { link, writeFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { isErrorCode } from './is-error-code.ts';
import { probeProcess } from './probe-process.ts';
import { readOptionalText } from './read-optional-text.ts';
import { readPIDNamespace } from './read-pid-namespace.ts';
import { removeFile } from './remove-file.ts';
import type { LockHost } from './with-file-lock.ts';

// The lock's view of this process and its disk.
export function createNodeLockHost(): LockHost {
  return {
    pid: process.pid,
    namespace: readPIDNamespace(),
    createToken: () => randomUUID(),
    nowMs: () => Date.now(),
    sleep: (durationMs) => Bun.sleep(durationMs),
    probeProcess,
    createDirectory,
    createFileOnce,
    readText: readOptionalText,
    removeFile,
  };
}

// The content goes into a file of its own, then `link` puts it at the path in one step, so the
// file is never seen empty, and a crash leaves either no file or a whole one.
async function createFileOnce(path: string, content: string): Promise<boolean> {
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
    await removeFile(draft);
  }
}
