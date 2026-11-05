import { launchReadyTimeoutMs } from './builtins/build-lifecycle-commands.ts';
import { createRepoState } from './create-repo-state.ts';
import { readLaunchHost } from './read-launch-host.ts';
import { runSupervisor } from './run-supervisor.ts';
import { supervisorArgsSchema } from './supervisor-protocol.ts';
import type { Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

const stopWaitMs = 10_000;

// The entry of the supervisor process: argv is what follows the hidden command name. The process
// exits once its run has stopped.
export async function runSupervisorProcess(
  wringer: Wringer,
  argv: readonly string[],
): Promise<void> {
  const parsed = supervisorArgsSchema.safeParse(argv);

  if (!parsed.success) {
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
    launchHost: readLaunchHost(),
    state: createRepoState(parsed.data.root, wringer.stateDir),
    runID: parsed.data.runID,
    target: parsed.data.target,
    readyTimeoutMs: launchReadyTimeoutMs,
    stopWaitMs,
    now: () => new Date(),

    // The process that starts the supervisor sends its stderr to the supervisor's log.
    reportError: (message) => {
      process.stderr.write(`${message}\n`);
    },
    signal: signalled.signal,
  });
}
