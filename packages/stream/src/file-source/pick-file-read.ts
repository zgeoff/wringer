import type { FilePosition } from './read-file-from.ts';

export interface FileFacts {
  readonly size: number;

  // The device and inode of the file at the path now.
  readonly identity: string;
}

export interface FileRead {
  readonly start: number;
  readonly length: number;
}

// A file that shrank, such as a log rotated in place, or a new file at the path, such as a log
// rotated by rename, reads from 0.
export function pickFileRead(file: FileFacts, from: FilePosition, limitBytes: number): FileRead {
  const replaced = from.identity !== null && from.identity !== file.identity;
  const start = replaced || file.size < from.offset ? 0 : from.offset;

  return { start, length: Math.min(file.size - start, limitBytes) };
}
