import { readFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { readText } from './read-text.ts';
import { removeDirectory } from './remove-directory.ts';
import { runGit, runGitBytes } from './run-git.ts';
import type { RepoHost } from './types.ts';
import { writeNewFile } from './write-new-file.ts';

// The commands' view of this machine's git and disk, for an entry point to pass in.
export function createNodeRepoHost(): RepoHost {
  return {
    runGit,
    runGitBytes,
    removeDirectory,
    readText,
    createDirectory,
    writeNewFile,
    readBytes: readFile,
  };
}
