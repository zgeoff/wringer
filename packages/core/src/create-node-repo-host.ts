import { readFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { readText } from './read-text.ts';
import { removeFile } from './remove-file.ts';
import { runGit, runGitBytes } from './run-git.ts';
import type { RepoHost } from './types.ts';
import { writeNewFile } from './write-new-file.ts';

// The commands' view of this machine's git and disk, for an entry point to pass in.
export function createNodeRepoHost(): RepoHost {
  return {
    runGit,
    runGitBytes,
    removeFile,
    readText,
    createDirectory,
    writeNewFile,
    readBytes: readFile,
  };
}
