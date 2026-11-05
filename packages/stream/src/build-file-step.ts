import type { FilePosition } from './read-file-from.ts';

export interface FileFollowState {
  readonly position: FilePosition;

  // The text after the last newline, which waits for the rest of its line.
  readonly carry: string;
}

export interface ChunkInfo {
  readonly start: number;
  readonly identity: string | null;
  readonly byteCount: number;
}

export interface FileStep {
  // The file shrank or was replaced, so its reader starts over with a fresh decoder.
  readonly restarted: boolean;
  readonly state: FileFollowState;

  // A read that filled its limit may have stopped short of the end.
  readonly more: boolean;
}

// A file that starts over drops the old file's unfinished line, so it never joins the new file's
// text.
export function buildFileStep(
  state: FileFollowState,
  chunk: ChunkInfo,
  limitBytes: number,
): FileStep {
  const restarted = chunk.start < state.position.offset;

  return {
    restarted,
    state: {
      position: { offset: chunk.start + chunk.byteCount, identity: chunk.identity },
      carry: restarted ? '' : state.carry,
    },
    more: chunk.byteCount === limitBytes,
  };
}
