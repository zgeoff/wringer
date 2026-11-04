import { join } from 'node:path';
import { probeProcess } from '../packages/core/src/probe-process.ts';
import type { FileSystem } from './ci/file-system.ts';
import { nodeFileSystem } from './ci/node-file-system.ts';

export interface StaleTestFoldersRequest {
  readonly root: string;
  readonly fileSystem: Pick<FileSystem, 'readFolderNames' | 'removePath'>;
  readonly probeProcess: (pid: number) => boolean;
}

// A test run that the runner kills skips its cleanup and leaves its temp folders behind.
export async function removeStaleTestFolders(
  request: StaleTestFoldersRequest,
): Promise<readonly string[]> {
  const folders = await readTestFolders(request.fileSystem, request.root);

  const owners = folders.flatMap((folder) => {
    const pid = parseTestFolderPID(folder.name);

    return pid === null ? [] : [pid];
  });

  const livePIDs = new Set(owners.filter((pid) => request.probeProcess(pid)));

  const stale = pickStaleTestFolders(folders, livePIDs);

  await Promise.all(stale.map((path) => request.fileSystem.removePath(path)));

  return stale;
}

export interface TestFolder {
  readonly name: string;
  readonly path: string;
}

const skippedFolderNames = new Set(['.git', '.worktrees', 'node_modules', 'dist']);

async function readTestFolders(
  fileSystem: Pick<FileSystem, 'readFolderNames'>,
  directory: string,
): Promise<readonly TestFolder[]> {
  const names = await fileSystem.readFolderNames(directory);

  const folders = names
    .filter((name) => !skippedFolderNames.has(name))
    .map((name) => ({ name, path: join(directory, name) }));

  const found = folders.filter((folder) => folder.name.startsWith('.test-'));

  const nested = await Promise.all(
    folders
      .filter((folder) => !folder.name.startsWith('.test-'))
      .map((folder) => readTestFolders(fileSystem, folder.path)),
  );

  return [...found, ...nested.flat()];
}

const testFolderPattern = /^\.test-p(?<pid>\d+)-/v;

function parseTestFolderPID(name: string): number | null {
  const pid = testFolderPattern.exec(name)?.groups?.['pid'];

  return pid === undefined ? null : Number(pid);
}

// A folder named after a process that still runs belongs to a run in progress, and a folder with
// no process in its name is not this sweep's to judge, so both stay.
export function pickStaleTestFolders(
  folders: readonly TestFolder[],
  livePIDs: ReadonlySet<number>,
): readonly string[] {
  return folders.flatMap((folder) => {
    const pid = parseTestFolderPID(folder.name);

    return pid === null || livePIDs.has(pid) ? [] : [folder.path];
  });
}

if (import.meta.main) {
  const removed = await removeStaleTestFolders({
    root: join(import.meta.dir, '..'),
    fileSystem: nodeFileSystem,
    probeProcess,
  });

  if (removed.length > 0) {
    process.stdout.write(`Removed ${removed.length} test folders that a killed run left.\n`);
  }
}
