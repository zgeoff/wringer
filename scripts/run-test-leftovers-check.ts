import { sep } from 'node:path';
import { isErrorCode } from '../packages/core/src/is-error-code.ts';
import type { FileSystem } from './ci/file-system.ts';
import type { TestFolder, TestFolderOwner } from './remove-stale-test-folders.ts';
import { parseTestFolderOwner, readTestFolders } from './remove-stale-test-folders.ts';

export interface ProcessLine {
  readonly pid: number;
  readonly args: string;
}

export interface TestLeftoversCheckRequest {
  readonly root: string;

  // The test process whose folders the check looks for, and its PID namespace.
  readonly owner: TestFolderOwner;

  readonly fileSystem: Pick<FileSystem, 'readFolderNames' | 'removePath'>;
  readonly readProcesses: () => readonly ProcessLine[];
  readonly stopProcess: (pid: number, signal: NodeJS.Signals) => void;

  // How long a leftover process gets to exit on its own, as a stopped supervisor does just after
  // it answers the stop.
  readonly exitWaitMs: number;
}

export interface TestLeftovers {
  readonly processes: readonly ProcessLine[];
  readonly folders: readonly string[];
}

// Runs once every test of the owner has ended, so a process that still names one of its test
// folders outlived its test, and so did a folder still on disk. The check stops and removes both,
// so the next run starts clean, and returns them for the caller to fail on.
export async function runTestLeftoversCheck(
  request: TestLeftoversCheckRequest,
): Promise<TestLeftovers> {
  const processes = await readLeftoverProcesses(request);

  for (const line of processes) {
    request.stopProcess(line.pid, 'SIGTERM');
  }

  // A stopped supervisor still writes its last events, which would bring a removed folder back, so
  // the folders go only once each process has exited or been killed.
  const unstopped = processes.length > 0 ? await readLeftoverProcesses(request) : [];

  for (const line of unstopped) {
    request.stopProcess(line.pid, 'SIGKILL');
  }

  const testFolders = await readTestFolders(request.fileSystem, request.root);

  const folders = pickLeftoverFolders(testFolders, { owner: request.owner });

  await Promise.all(folders.map((path) => request.fileSystem.removePath(path)));

  return { processes, folders };
}

// The leftover processes that are still running once each has had the wait to exit.
async function readLeftoverProcesses(
  request: TestLeftoversCheckRequest,
): Promise<readonly ProcessLine[]> {
  const deadline = Date.now() + request.exitWaitMs;
  let processes = pickLeftoverProcesses(request.readProcesses(), request);

  while (processes.length > 0 && Date.now() < deadline) {
    await Bun.sleep(100);

    processes = pickLeftoverProcesses(request.readProcesses(), request);
  }

  return processes;
}

export interface LeftoverScope {
  readonly root: string;
  readonly owner: TestFolderOwner;
}

// A process is a leftover when one of its arguments is a path under the root that goes through a
// test folder of the owner. `ps` joins the arguments with spaces, so the path after the root ends at
// the first space, and the root itself may hold one.
export function pickLeftoverProcesses(
  processes: readonly ProcessLine[],
  scope: LeftoverScope,
): readonly ProcessLine[] {
  const prefix = `${scope.root}${sep}`;

  return processes.filter((line) =>
    collectPathsUnder(line.args, prefix).some((path) =>
      path.split(sep).some((segment) => isOwnedBy(segment, scope.owner)),
    ),
  );
}

// The part after `prefix` of each argument that starts with it.
function collectPathsUnder(args: string, prefix: string): readonly string[] {
  const paths: string[] = [];

  for (let index = args.indexOf(prefix); index !== -1; index = args.indexOf(prefix, index + 1)) {
    if (index === 0 || /\s/v.test(args.charAt(index - 1))) {
      paths.push(args.slice(index + prefix.length).split(/\s/v)[0] ?? '');
    }
  }

  return paths;
}

export function pickLeftoverFolders(
  folders: readonly TestFolder[],
  scope: Pick<LeftoverScope, 'owner'>,
): readonly string[] {
  return folders
    .filter((folder) => isOwnedBy(folder.name, scope.owner))
    .map((folder) => folder.path);
}

function isOwnedBy(name: string, owner: TestFolderOwner): boolean {
  const parsed = parseTestFolderOwner(name);

  return parsed?.namespace === owner.namespace && parsed.pid === owner.pid;
}

// `ps -o pid=,args=` prints each process as its PID, then its arguments joined by spaces.
export function parseProcessLines(text: string): readonly ProcessLine[] {
  return text.split('\n').flatMap((row) => {
    const groups = /^\s*(?<pid>\d+)\s+(?<args>.*)$/v.exec(row)?.groups;

    return groups === undefined ? [] : [{ pid: Number(groups['pid']), args: groups['args'] ?? '' }];
  });
}

export function readProcesses(): readonly ProcessLine[] {
  const result = Bun.spawnSync(['ps', '-A', '-o', 'pid=,args='], { stdout: 'pipe' });

  if (result.exitCode !== 0) {
    throw new Error(`ps exited with code ${result.exitCode}`);
  }

  return parseProcessLines(result.stdout.toString());
}

export function stopProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isErrorCode(error, 'ESRCH')) {
      throw error;
    }
  }
}
