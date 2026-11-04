import type { RunView } from '../build-run-view.ts';
import { callSupervisor } from '../call-supervisor.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import { WringerError } from '../wringer-error.ts';

export type SupervisorReach = 'answered' | 'gone';

// `gone` only when nothing listens on the run's socket, or the run never got one. A call that times
// out or fails in any other way may still reach a live supervisor later, so it rejects, and the
// caller leaves the run as it is.
export async function callRunSupervisor(
  run: RunView,
  method: 'ping' | 'stop',
  signal: AbortSignal,
): Promise<SupervisorReach> {
  if (run.supervisor === null) {
    return 'gone';
  }

  try {
    await callSupervisor({
      socket: run.supervisor.socket,
      request: { service: supervisorServiceName, method, args: null },
      signal,
    });

    return 'answered';
  } catch (error) {
    if (isSupervisorGone(error)) {
      return 'gone';
    }

    throw error;
  }
}

export function isSupervisorGone(error: unknown): boolean {
  return error instanceof WringerError && error.code === 'not-running';
}
