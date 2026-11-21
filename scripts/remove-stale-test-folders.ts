import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunFolderPrefix } from '@zgeoff/testing/fs';
import { probeProcess } from '../packages/core/src/host/probe-process.ts';
import type { FileSystem } from './ci/file-system.ts';
import { nodeFileSystem } from './ci/node-file-system.ts';

export interface StaleTestFoldersRequest {
  readonly root: string;
  readonly namespace: string;
  readonly fileSystem: Pick<FileSystem, 'readFolderNames' | 'removePath'>;
  readonly probeProcess: (pid: number) => boolean;
}

// A test run that the runner kills skips its cleanup and leaves its temp folders behind. The sweep
// reads the temp folder, where the kit makes them.
export async function removeStaleTestFolders(
  request: StaleTestFoldersRequest,
): Promise<readonly string[]> {
  const folders = await readTestFolders(request.fileSystem, request.root);

  const livePIDs = new Set(
    collectTestFolderPIDs(folders, request.namespace).filter((pid) => request.probeProcess(pid)),
  );

  const stale = pickStaleTestFolders(folders, { namespace: request.namespace, livePIDs });

  await Promise.all(stale.map((path) => request.fileSystem.removePath(path)));

  return stale;
}

export interface TestFolder {
  readonly name: string;
  readonly path: string;
}

// The kit's test folders sit directly in the temp folder, each named with the process and the PID
// namespace of the run that made it.
export async function readTestFolders(
  fileSystem: Pick<FileSystem, 'readFolderNames'>,
  directory: string,
): Promise<readonly TestFolder[]> {
  const names = await fileSystem.readFolderNames(directory);

  return names
    .filter((name) => parseTestFolderOwner(name) !== null)
    .map((name) => ({ name, path: join(directory, name) }));
}

// The PIDs worth a liveness check: those of folders from this namespace only.
function collectTestFolderPIDs(folders: readonly TestFolder[], namespace: string): number[] {
  return folders.flatMap((folder) => {
    const owner = parseTestFolderOwner(folder.name);

    return owner?.namespace === namespace ? [owner.pid] : [];
  });
}

export interface TestFolderOwner {
  readonly namespace: string;
  readonly pid: number;
}

const testFolderPattern = /pid(?<pid>\d+)-ns(?<namespace>\d+|host|unknown)-/v;

export function parseTestFolderOwner(name: string): TestFolderOwner | null {
  const groups = testFolderPattern.exec(name)?.groups;

  if (groups === undefined) {
    return null;
  }

  return { namespace: groups['namespace'] ?? '', pid: Number(groups['pid']) };
}

// The owner that the kit puts in the name of each folder this process makes.
export function readTestRunOwner(): TestFolderOwner {
  const owner = parseTestFolderOwner(readRunFolderPrefix(''));

  if (owner === null) {
    throw new Error('The kit names its test folders after the process and its PID namespace.');
  }

  return owner;
}

export interface LiveProcesses {
  readonly namespace: string;
  readonly livePIDs: ReadonlySet<number>;
}

// Only a folder from this PID namespace whose process has ended is stale. A folder from another
// namespace may belong to a run whose PID means nothing here, and a folder with no owner in its
// name is not this sweep's to judge, so both stay.
export function pickStaleTestFolders(
  folders: readonly TestFolder[],
  live: LiveProcesses,
): readonly string[] {
  return folders.flatMap((folder) => {
    const owner = parseTestFolderOwner(folder.name);

    if (owner === null || owner.namespace !== live.namespace || live.livePIDs.has(owner.pid)) {
      return [];
    }

    return [folder.path];
  });
}

if (import.meta.main) {
  const removed = await removeStaleTestFolders({
    root: tmpdir(),
    namespace: readTestRunOwner().namespace,
    fileSystem: nodeFileSystem,
    probeProcess,
  });

  if (removed.length > 0) {
    process.stdout.write(`Removed ${removed.length} test folders that a killed run left.\n`);
  }
}
