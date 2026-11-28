import { isErrorCode } from '../is-error-code.ts';

// Whether a read failed because the path holds no file: it is gone, a folder now stands there, or a
// file now stands where a parent folder was.
export function isMissingFile(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR', 'EISDIR'].some((code) => isErrorCode(error, code));
}
