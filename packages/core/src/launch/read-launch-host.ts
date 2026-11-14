import { appendFile } from 'node:fs/promises';
import { createDirectory } from '../file-system/create-directory.ts';
import { removeDirectory } from '../file-system/remove-directory.ts';
import { killProcessGroup } from '../host/kill-process-group.ts';
import { runProcess } from '../host/run-process.ts';
import type { ProcessRequest, ProcessResult } from '../host/run-process.ts';
import { createSocketFolder } from '../supervisor/create-socket-folder.ts';
import { listenSupervisorSocket } from '../supervisor/listen-supervisor-socket.ts';
import type {
  SupervisorSocket,
  SupervisorSocketOptions,
} from '../supervisor/listen-supervisor-socket.ts';
import { buildLaunchGuard } from './build-launch-guard.ts';

export interface AppSpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface AppProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
}

// Everything the launch reads from or does to this machine.
export interface LaunchHost {
  readonly guard: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawnApp: (argv: readonly string[], options: AppSpawnOptions) => AppProcess;
  readonly appendLog: (path: string, text: string) => Promise<void>;
  readonly createDirectory: (path: string) => Promise<void>;

  // Returns the socket's path, in the temp folder when the preferred path is too long for a socket.
  readonly createSocketFolder: (preferredSocket: string) => Promise<string>;
  readonly removeDirectory: (path: string) => Promise<void>;
  readonly listenSupervisorSocket: (options: SupervisorSocketOptions) => Promise<SupervisorSocket>;
  readonly killProcessGroup: (pid: number, signal?: NodeJS.Signals) => void;
  readonly runProcess: (request: ProcessRequest) => Promise<ProcessResult>;
}

// The app gets a process group of its own, so a stop can signal every process it started.
export function readLaunchHost(): LaunchHost {
  return {
    guard: buildLaunchGuard(Bun.which('setpriv')),
    cwd: process.cwd(),
    env: { ...process.env },
    spawnApp: (argv, options) =>
      Bun.spawn([...argv], {
        cwd: options.cwd,
        env: { ...options.env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        detached: true,
      }),
    appendLog: appendFile,
    createDirectory,
    createSocketFolder,
    removeDirectory,
    listenSupervisorSocket,
    killProcessGroup,
    runProcess,
  };
}
