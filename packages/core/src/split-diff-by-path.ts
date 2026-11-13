import type { RawEntry } from './parse-raw-entries.ts';
import { WringerError } from './wringer-error.ts';

export interface PathChunk {
  readonly path: Buffer;
  readonly bytes: Buffer;
}

// Gives each path of the `--raw -z` list its chunks of the diff, in order, so a space, a quote or a
// newline in a path is safe. A type change, such as a file that became a symlink, owns two chunks.
export function splitDiffByPath(
  diff: Uint8Array,
  entries: readonly RawEntry[],
): readonly PathChunk[] {
  const chunks = splitChunks(Buffer.from(diff));
  const expected = entries.reduce((total, entry) => total + countChunks(entry), 0);

  if (chunks.length !== expected) {
    throw new WringerError('internal', {
      message: `The diff holds ${chunks.length} chunks for ${expected} expected from ${entries.length} changed paths.`,
    });
  }

  const owned: PathChunk[] = [];
  let next = 0;

  for (const entry of entries) {
    for (let count = countChunks(entry); count > 0; count -= 1) {
      owned.push({ path: entry.path, bytes: chunks[next] ?? Buffer.alloc(0) });

      next += 1;
    }
  }

  return owned;
}

// A line of content always starts with a space, a plus, a minus or a backslash, and a binary patch
// line holds no space, so `diff --git ` at the start of a line is always a header.
const headerStart = Buffer.from('diff --git ');

function splitChunks(diff: Buffer): readonly Buffer[] {
  const starts: number[] = [];
  let at = diff.indexOf(headerStart);

  while (at !== -1) {
    if (at === 0 || diff[at - 1] === 0x0a) {
      starts.push(at);
    }

    at = diff.indexOf(headerStart, at + 1);
  }

  return starts.map((start, index) => diff.subarray(start, starts[index + 1] ?? diff.length));
}

function countChunks(entry: RawEntry): number {
  return entry.status === 'T' ? 2 : 1;
}
