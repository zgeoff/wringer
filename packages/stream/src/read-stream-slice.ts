import { open } from 'node:fs/promises';
import { z } from 'zod';

export const streamRecordSchema = z.strictObject({ at: z.string(), line: z.string() });

export type StreamRecord = z.infer<typeof streamRecordSchema>;

export interface StreamSliceRequest {
  readonly path: string;
  readonly from: number;
  readonly maxBytes: number;
}

export interface StreamSlice {
  readonly records: readonly StreamRecord[];
  readonly cursor: number;
  readonly more: boolean;
}

const newline = 0x0a;

// Reads whole records from the byte offset `from`, up to `maxBytes`. The recorder caps each record
// well under the smallest slice, so a full slice always ends on a line end. A cursor past the end
// of the file comes from an older run, so the read starts over at 0.
export async function readStreamSlice(request: StreamSliceRequest): Promise<StreamSlice> {
  const handle = await open(request.path, 'r').catch(() => null);

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

    const end = buffer.lastIndexOf(newline) + 1;

    const records = buffer
      .subarray(0, end)
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => parseRecord(line));

    return { records, cursor: from + end, more: from + end < size };
  } finally {
    await handle.close();
  }
}

type FileHandle = Awaited<ReturnType<typeof open>>;

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

function parseRecord(line: string): StreamRecord {
  const parsed: unknown = JSON.parse(line);

  return streamRecordSchema.parse(parsed);
}
