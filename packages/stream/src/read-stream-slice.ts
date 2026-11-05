import { open } from 'node:fs/promises';
import { WringerError, isErrorCode } from '@wringer/core';
import { buildStreamSlice } from './build-stream-slice.ts';
import type { StreamSlice } from './build-stream-slice.ts';

export interface StreamSliceRequest {
  readonly path: string;
  readonly from: number;
  readonly maxBytes: number;
}

// Reads whole records from the byte offset `from`, up to `maxBytes`. A file the machine refuses to
// read, such as a folder at the stream's path, is a fault of the environment, not of wringer.
export async function readStreamSlice(request: StreamSliceRequest): Promise<StreamSlice> {
  try {
    return await readSlice(request);
  } catch (error) {
    throw new WringerError('environment', {
      message: `The stream file ${request.path} could not be read: ${String(error)}`,
    });
  }
}

// The recorder caps each record well under the smallest slice, so a full slice always ends on a
// line end. A cursor past the end of the file comes from an older run, so the read starts over at 0.
async function readSlice(request: StreamSliceRequest): Promise<StreamSlice> {
  const handle = await openStreamFile(request.path);

  if (handle === null) {
    return { records: [], cursor: 0, more: false };
  }

  try {
    const info = await handle.stat();

    const size = info.size;
    const requested = request.from > size ? 0 : request.from;

    const from = await readLineStart(handle, requested, size);

    const length = Math.min(request.maxBytes, size - from);
    const buffer = Buffer.alloc(length);

    await handle.read(buffer, 0, length, from);

    return buildStreamSlice(buffer, from, size);
  } finally {
    await handle.close();
  }
}

type FileHandle = Awaited<ReturnType<typeof open>>;

// A stream that has recorded nothing yet has no file. Any other failure, such as EACCES, rejects.
async function openStreamFile(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, 'r');
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}

const newline = 0x0a;

// A cursor a caller typed may land inside a record; the read then starts at the next one.
async function readLineStart(handle: FileHandle, from: number, size: number): Promise<number> {
  if (from === 0) {
    return 0;
  }

  const buffer = Buffer.alloc(Math.min(size - from + 1, 64 * 1024));

  await handle.read(buffer, 0, buffer.length, from - 1);

  const index = buffer.indexOf(newline);

  return index === -1 ? size : from + index;
}
