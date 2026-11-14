import { isErrorCode } from '../is-error-code.ts';

// Signal 0 checks that the process exists and sends nothing. EPERM means it runs as another user.
export function probeProcess(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return isErrorCode(error, 'EPERM');
  }
}
