export interface KeyMods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly super: boolean;
}

// One key event. `key` is a name from `keyNames`, and `text` is what the key types when no
// modifier but shift is held.
export interface KeyInput {
  readonly key: string;
  readonly mods: KeyMods;
  readonly text?: string | undefined;
}

// Rows and columns count from 0, from the top left of the screen.
export interface CursorState {
  readonly row: number;
  readonly col: number;
  readonly visible: boolean;
}

interface ScreenSize {
  readonly cols: number;
  readonly rows: number;
}

// The screen a program draws on. An engine takes the bytes the program wrote and answers what a
// reader sees, and turns a key into the bytes the program expects under its current modes.
export interface ScreenEngine {
  readonly write: (bytes: Uint8Array) => void;
  readonly resize: (size: ScreenSize) => void;
  readonly text: () => string;
  readonly cursor: () => CursorState;
  readonly encodeKey: (key: KeyInput) => Uint8Array;
  readonly dispose: () => void;
}
