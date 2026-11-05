import { open } from 'node:fs/promises';

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
// `tail -F` treats it; a file that shrank, such as a log rotated in place, or a new file at the
// path, such as a log rotated by rename, reads from 0.
export async function readFileFrom(
  path: string,
  from: FilePosition,
  limitBytes: number,
): Promise<FileChunk> {
  const handle = await open(path, 'r').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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
    const replaced = from.identity !== null && from.identity !== identity;
    const start = replaced || stats.size < from.offset ? 0 : from.offset;

    const bytes = new Uint8Array(Math.min(stats.size - start, limitBytes));

    // A file truncated after the stat yields fewer bytes than the buffer holds.
    const read = await handle.read(bytes, 0, bytes.length, start);

    return { start, identity, bytes: bytes.subarray(0, read.bytesRead) };
  } finally {
    await handle.close();
  }
}
