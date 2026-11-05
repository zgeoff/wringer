import { isErrorCode } from '@wringer/core';
import { pickFileRead } from './pick-file-read.ts';
import type { OpenFile } from './types.ts';

// Where a reader left a file: the byte offset, and the device and inode of the file it read, or
// null before it read one.
export interface FilePosition {
  readonly offset: number;
  readonly identity: string | null;
}

export interface FileChunk {
  // Where `bytes` starts: the offset, or 0 once the file shrank below it or was replaced.
  readonly start: number;
  readonly identity: string | null;
  readonly bytes: Uint8Array;
}

// Up to `limitBytes` of a file from `from`. A file that does not exist yet reads as empty, as
// `tail -F` treats it.
export async function readFileFrom(
  path: string,
  from: FilePosition,
  limitBytes: number,
  openFile: OpenFile,
): Promise<FileChunk> {
  const handle = await openFile(path).catch((error: unknown) => {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  });

  if (handle === null) {
    return { start: from.offset, identity: from.identity, bytes: new Uint8Array() };
  }

  try {
    const stats = await handle.stat();

    const identity = `${stats.dev}:${stats.ino}`;
    const plan = pickFileRead({ size: stats.size, identity }, from, limitBytes);

    const bytes = new Uint8Array(plan.length);

    // A file truncated after the stat yields fewer bytes than the buffer holds.
    const read = await handle.read(bytes, 0, bytes.length, plan.start);

    return { start: plan.start, identity, bytes: bytes.subarray(0, read.bytesRead) };
  } finally {
    await handle.close();
  }
}
