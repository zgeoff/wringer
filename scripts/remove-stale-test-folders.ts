import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface StaleTestFoldersRequest {
  readonly root: string;
  readonly probeProcess: (pid: number) => boolean;
}

// A test run that the runner kills skips its cleanup and leaves its temp folders behind. A folder
// named after a process that still runs belongs to a run in progress, so the sweep keeps it.
export async function removeStaleTestFolders(
  request: StaleTestFoldersRequest,
): Promise<readonly string[]> {
  const folders = await readTestFolders(request.root);

  const stale = folders.filter((folder) => {
    const pid = parseTestFolderPID(folder.name);

    return pid !== null && !request.probeProcess(pid);
  });

  await Promise.all(stale.map((folder) => rm(folder.path, { recursive: true, force: true })));

  return stale.map((folder) => folder.path);
}

interface TestFolder {
  readonly name: string;
  readonly path: string;
}

const skippedFolderNames = new Set(['.git', '.worktrees', 'node_modules', 'dist']);

async function readTestFolders(directory: string): Promise<readonly TestFolder[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const folders = entries
    .filter((entry) => entry.isDirectory() && !skippedFolderNames.has(entry.name))
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }));

  const found = folders.filter((folder) => folder.name.startsWith('.test-'));

  const nested = await Promise.all(
    folders
      .filter((folder) => !folder.name.startsWith('.test-'))
      .map((folder) => readTestFolders(folder.path)),
  );

  return [...found, ...nested.flat()];
}

const testFolderPattern = /^\.test-p(?<pid>\d+)-/v;

function parseTestFolderPID(name: string): number | null {
  const pid = testFolderPattern.exec(name)?.groups?.['pid'];

  return pid === undefined ? null : Number(pid);
}

// Signal 0 checks that the process exists and sends nothing. EPERM means it runs as another user.
export function probeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

if (import.meta.main) {
  const removed = await removeStaleTestFolders({ root: join(import.meta.dir, '..'), probeProcess });

  if (removed.length > 0) {
    process.stdout.write(`Removed ${removed.length} test folders that a killed run left.\n`);
  }
}
