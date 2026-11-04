import { randomUUID } from 'node:crypto';
import { appendFile, readFile, readdir, rename, stat, truncate, writeFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { isErrorCode } from './is-error-code.ts';

// The file operations the run state needs. A missing file or folder reads as null or as no names;
// every other failure, such as EACCES or EIO, rejects.
export interface StateFileSystem {
  readonly readText: (path: string) => Promise<string | null>;
  readonly listNames: (directory: string) => Promise<readonly string[]>;
  readonly readFileSize: (path: string) => Promise<number>;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly appendText: (path: string, text: string) => Promise<void>;
  readonly truncateFile: (path: string, length: number) => Promise<void>;
  readonly writeTextAtomic: (path: string, text: string) => Promise<void>;
}

export function createNodeStateFileSystem(): StateFileSystem {
  return {
    readText: async (path) => {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (isErrorCode(error, 'ENOENT')) {
          return null;
        }

        throw error;
      }
    },
    listNames: async (directory) => {
      try {
        return await readdir(directory);
      } catch (error) {
        if (isErrorCode(error, 'ENOENT')) {
          return [];
        }

        throw error;
      }
    },
    createDirectory,

    // `appendFile` writes on until the whole text is in the file, and the caller holds the run lock,
    // so no other append lands between two of its writes.
    appendText: (path, text) => appendFile(path, text),
    readFileSize: async (path) => {
      const info = await stat(path);

      return info.size;
    },
    truncateFile: (path, length) => truncate(path, length),
    writeTextAtomic: async (path, text) => {
      const temporary = `${path}.${randomUUID()}.tmp`;

      await writeFile(temporary, text, { flag: 'wx' });
      await rename(temporary, path);
    },
  };
}
