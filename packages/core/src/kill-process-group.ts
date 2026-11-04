import { isErrorCode } from './is-error-code.ts';

// Kills a child spawned with `detached: true` together with every process it started: a negative
// PID names the process group. The group may already be gone.
export function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!isErrorCode(error, 'ESRCH')) {
      throw error;
    }
  }
}
