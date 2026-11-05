import type { FingerprintHost } from './read-fingerprint.ts';
import { removeFile } from './remove-file.ts';
import { runGit } from './run-git.ts';

// The fingerprint's view of this machine's git and disk, for an entry point to pass in.
export function createNodeFingerprintHost(): FingerprintHost {
  return { runGit, removeFile };
}
