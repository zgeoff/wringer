import { readFile } from 'node:fs/promises';
import { isErrorCode } from './is-error-code.ts';

// A missing file reads as null; every other failure, such as EACCES or EIO, rejects.
export async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}
