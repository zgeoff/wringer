import { appendText } from './append-text.ts';
import { createDirectory } from './create-directory.ts';
import { killProcessGroup } from './kill-process-group.ts';
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
    appendLog: appendText,
    createDirectory,
    killProcessGroup,
    runProcess,
  };
}
