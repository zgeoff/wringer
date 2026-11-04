import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, rename, stat, truncate, writeFile } from 'node:fs/promises';
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

    // A write may take fewer bytes than it was given, so the append writes on from where the last
    // write stopped until the whole text is in the file. The caller holds the run lock, so no other
    // append lands between two of these writes.
    appendText: async (path, text) => {
      const handle = await open(path, 'a');

      const bytes = Buffer.from(text);

      try {
        let written = 0;

        while (written < bytes.length) {
          const result = await handle.write(bytes, written);

          written += result.bytesWritten;
        }
      } finally {
        await handle.close();
      }
    },
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
