import {
  createNodeFingerprintHost,
  createRepoState,
  makeProcessSupervisorStarter,
  runSupervisorProcess,
} from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { getAgentProfile } from 'gunshi/agent';
import { readRepoRoot } from './read-repo-root.ts';
import { runCLI } from './run-cli.ts';

// The repo's verify script calls this with its registry. The script restarts itself as the run's
// supervisor, so the supervisor's command is the runtime and the script, without the user's
// arguments.
export async function runVerify(wringer: Wringer): Promise<void> {
  const [, script] = process.argv;
  const selfCommand = script === undefined ? [process.execPath] : [process.execPath, script];

  process.exitCode = await runCLI(wringer, {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY,
    isAgent: getAgentProfile().isAgent,
    writeStdout: (text) => {
      process.stdout.write(text);
    },
    readRepoRoot,
    openRepo: (root) => ({
      state: createRepoState(root, wringer.stateDir),
      fingerprintHost: createNodeFingerprintHost(),
      supervisor: makeProcessSupervisorStarter({ selfCommand, root, stateDir: wringer.stateDir }),
    }),
    runSupervisor: runSupervisorProcess,
  });
}
