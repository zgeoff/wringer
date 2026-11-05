import type { FileHandle } from 'node:fs/promises';

// Opens a file for reading. The driver passes `open(path, 'r')` from `node:fs/promises`.
export type OpenFile = (path: string) => Promise<FileHandle>;
