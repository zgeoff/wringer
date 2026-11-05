import { open } from 'node:fs/promises';

export interface FileChunk {
  // Where `bytes` starts: `from`, or 0 once the file has shrunk below `from`.
  readonly start: number;
  readonly bytes: Uint8Array;
}

// The bytes of a file from the offset `from` to its end. A file that does not exist yet reads as
// empty, as `tail -F` treats it; a file that shrank, such as a log rotated in place, reads from 0.
export async function readFileFrom(path: string, from: number): Promise<FileChunk> {
  const handle = await open(path, 'r').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (handle === null) {
    return { start: from, bytes: new Uint8Array() };
  }

  try {
    const stats = await handle.stat();

    const start = stats.size < from ? 0 : from;

    const bytes = new Uint8Array(stats.size - start);

    // A file truncated after the stat yields fewer bytes than the buffer holds.
    const read = await handle.read(bytes, 0, bytes.length, start);

    return { start, bytes: bytes.subarray(0, read.bytesRead) };
  } finally {
    await handle.close();
  }
}
