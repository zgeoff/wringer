import { join } from 'node:path';
import { launchReadyTimeoutMs } from './builtins/build-lifecycle-commands.ts';
import { createFileState } from './create-file-state.ts';
import { runSupervisor } from './run-supervisor.ts';
import type { Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

const lockTimeoutMs = 30_000;

// The entry of the supervisor process: argv is the run ID, the target and the worktree root, after
// the hidden command name. The process exits once its run has stopped.
export async function runSupervisorProcess(
  wringer: Wringer,
  argv: readonly string[],
): Promise<void> {
  const [runID, target, root] = argv;

  if (runID === undefined || target === undefined || root === undefined) {
    throw new WringerError('usage', { message: 'The supervisor needs a run ID, target and root.' });
  }

  const signalled = new AbortController();

  process.once('SIGTERM', () => {
    signalled.abort();
  });

  process.once('SIGINT', () => {
    signalled.abort();
  });

  await runSupervisor({
    wringer,
    state: createFileState({ stateDir: join(root, wringer.stateDir), lockTimeoutMs }),
    runID,
    target,
    readyTimeoutMs: launchReadyTimeoutMs,
    now: () => new Date(),
    signal: signalled.signal,
  });
}
