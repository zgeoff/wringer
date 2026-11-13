import { isErrorCode } from './is-error-code.ts';

export interface KillProcessGroupHost {
  kill: (pid: number, signal: NodeJS.Signals) => void;
  platform: NodeJS.Platform;
}

const processHost: KillProcessGroupHost = {
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  platform: process.platform,
};

// Kills a child spawned with `detached: true` together with every process it started: a negative
// PID names the process group. The group may already be gone. On darwin every `EPERM` reads as gone:
// a group of only unreaped zombies answers it, and the code cannot tell that from a live group.
export function killProcessGroup(
  pid: number,
  signal: NodeJS.Signals = 'SIGKILL',
  host: KillProcessGroupHost = processHost,
): void {
  try {
    host.kill(-pid, signal);
  } catch (error) {
    const isGone =
      isErrorCode(error, 'ESRCH') || (host.platform === 'darwin' && isErrorCode(error, 'EPERM'));

    if (!isGone) {
      throw error;
    }
  }
}
