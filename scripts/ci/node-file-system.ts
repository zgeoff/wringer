import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDirectory } from '../../packages/core/src/create-directory.ts';
import { isErrorCode } from '../../packages/core/src/is-error-code.ts';
import { readText } from '../../packages/core/src/read-text.ts';
import { removeDirectory } from '../../packages/core/src/remove-directory.ts';
import type { FileSystem } from './file-system.ts';

export const nodeFileSystem: FileSystem = {
  readText,
  readBytes: async (path) => {
    const buffer = await readFile(path);

    return new Uint8Array(buffer);
  },
  readDirectory: readdir,
  readFolderNames: async (path) => {
    const entries = await readdir(path, { withFileTypes: true });

    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  },
  writeText: async (path, text) => {
    await createDirectory(dirname(path));
    await writeFile(path, text);
  },
  appendText: appendFile,
  createDirectory,
  removePath: removeDirectory,
  probePath: async (path) => {
    try {
      await stat(path);

      return true;
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        return false;
      }

      throw error;
    }
  },
};
