import { readFile } from 'node:fs/promises';
import { removeFile } from './remove-file.ts';
import { runGit } from './run-git.ts';
import type { RepoHost } from './types.ts';

// The built-in commands' view of this machine's git and disk, for an entry point to pass in.
export function createNodeRepoHost(): RepoHost {
  return { runGit, removeFile, readText: (path) => readFile(path, 'utf8') };
}
