import { appendFile } from 'node:fs/promises';

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

export interface LaunchHost {
  readonly guard: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawnApp: (argv: readonly string[], options: AppSpawnOptions) => AppProcess;
  readonly appendLog: (path: string, text: string) => Promise<void>;
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
    appendLog: (path, text) => appendFile(path, text),
  };
}
