import { z } from 'zod';

export const streamRecordSchema = z.strictObject({ at: z.string(), line: z.string() });

export type StreamRecord = z.infer<typeof streamRecordSchema>;

export interface StreamSlice {
  readonly records: readonly StreamRecord[];
  readonly cursor: number;
  readonly more: boolean;
}

const newline = 0x0a;

// The bytes read from `from` end in a part record when the read stopped mid-line; the slice keeps
// the whole records, and its cursor points at the first byte it left.
export function buildStreamSlice(bytes: Buffer, from: number, size: number): StreamSlice {
  const end = bytes.lastIndexOf(newline) + 1;

  const records = bytes
    .subarray(0, end)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => parseRecord(line));

  return { records, cursor: from + end, more: from + end < size };
}

function parseRecord(line: string): StreamRecord {
  const parsed: unknown = JSON.parse(line);

  return streamRecordSchema.parse(parsed);
}
