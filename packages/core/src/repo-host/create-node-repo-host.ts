import { readFile } from 'node:fs/promises';
import { runGit, runGitBytes } from '../change-facts/run-git.ts';
import { createDirectory } from '../file-system/create-directory.ts';
import { inspectFile } from '../file-system/inspect-file.ts';
import { readText } from '../file-system/read-text.ts';
import { removeDirectory } from '../file-system/remove-directory.ts';
import { writeNewFile } from '../file-system/write-new-file.ts';
import type { RepoHost } from '../types.ts';

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
    inspectFile,
  };
}
