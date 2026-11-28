import { createHash } from 'node:crypto';

export interface WalkKeyInput {
  readonly head: string;
  readonly entries: readonly (readonly [string, readonly string[]])[];

  // The sha-256 of each file that differs from HEAD, or null for one that is gone, by path.
  readonly changed: readonly (readonly [string, string | null])[];
}

// Bumped when the walk's rules change, so an older cache file is never read.
const walkVersion = 1;

// One walk per commit, and per state of the files that differ from it: an edit to a file that is
// not committed yet changes the key.
export function buildWalkKey(input: WalkKeyInput): string {
  return createHash('sha256')
    .update(JSON.stringify([walkVersion, input.head, input.entries, input.changed]))
    .digest('hex')
    .slice(0, 32);
}
