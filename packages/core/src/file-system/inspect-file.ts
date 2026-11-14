import { lstat, realpath } from 'node:fs/promises';
import { isErrorCode } from '../is-error-code.ts';
import type { FileFacts } from '../types.ts';

// Resolves null for a path that does not exist. A symlink is not a regular file, and its real path
// is its target's.
export async function inspectFile(path: string): Promise<FileFacts | null> {
  try {
    const info = await lstat(path);

    return { realPath: await realpath(path), isRegularFile: info.isFile() };
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}
