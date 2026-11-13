import { parseRawEntries } from './parse-raw-entries.ts';
import type { RawEntry } from './parse-raw-entries.ts';

export interface DiffOutput {
  readonly entries: readonly RawEntry[];
  readonly patch: Buffer;
}

// Reads the output of `git diff --raw --patch -z`: the raw entries, each ended by a NUL byte, then
// one more NUL byte, then the patch.
export function parseDiffOutput(output: Uint8Array): DiffOutput {
  const bytes = Buffer.from(output);
  let end = 0;

  while (bytes[end] === 0x3a) {
    end = skipField(bytes, skipField(bytes, end));
  }

  return {
    entries: parseRawEntries(bytes.subarray(0, end)),
    patch: bytes.subarray(end + 1),
  };
}

function skipField(bytes: Buffer, start: number): number {
  const end = bytes.indexOf(0, start);

  return end === -1 ? bytes.length : end + 1;
}
