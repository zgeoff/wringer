import { appendFile } from 'node:fs/promises';
import { createDirectory } from './create-directory.ts';
import { createSocketFolder } from './create-socket-folder.ts';
import { killProcessGroup } from './kill-process-group.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';
import type { SupervisorSocket, SupervisorSocketOptions } from './listen-supervisor-socket.ts';
import { removeDirectory } from './remove-directory.ts';
import { runProcess } from './run-process.ts';
import type { ProcessRequest, ProcessResult } from './run-process.ts';

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

// setpriv asks the kernel to kill the app when the supervisor dies; hosts without setpriv, such as
// macOS, run the app without that guard. The app gets a process group of its own, so a stop can
// signal every process it started.
export function readLaunchHost(): LaunchHost {
  const guard = Bun.which('setpriv') === null ? [] : ['setpriv', '--pdeathsig', 'KILL', '--'];

  return {
    guard,
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
