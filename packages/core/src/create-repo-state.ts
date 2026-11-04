import { join } from 'node:path';
import { createFileState } from './create-file-state.ts';
import type { StatePort } from './create-file-state.ts';
import { createNodeLockHost } from './create-node-lock-host.ts';
import { createNodeStateFileSystem } from './create-node-state-file-system.ts';
import { makeFileLock } from './with-file-lock.ts';

const lockTimeoutMs = 30_000;

// The run state on disk under the repo's state folder, for an entry point to pass in.
export function createRepoState(root: string, stateDir: string): StatePort {
  return createFileState({
    stateDir: join(root, stateDir),
    lockTimeoutMs,
    fs: createNodeStateFileSystem(),
    lock: makeFileLock(createNodeLockHost()),
  });
}
