import { readFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { removeFile } from './remove-file.ts';
import { runGit } from './run-git.ts';
import type { RepoHost } from './types.ts';
import { writeNewFile } from './write-new-file.ts';

// The commands' view of this machine's git and disk, for an entry point to pass in.
export function createNodeRepoHost(): RepoHost {
  return {
    runGit,
    removeFile,
    readText: (path) => readFile(path, 'utf8'),
    createDirectory,
    writeNewFile,
    readBytes: readFile,
  };
}
