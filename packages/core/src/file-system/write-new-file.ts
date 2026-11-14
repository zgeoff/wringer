import { writeFile } from 'node:fs/promises';
import { isErrorCode } from '../is-error-code.ts';

// Creates the file with the bytes, and returns false, writing nothing, when the path exists.
export async function writeNewFile(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await writeFile(path, bytes, { flag: 'wx' });

    return true;
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) {
      return false;
    }

    throw error;
  }
}
