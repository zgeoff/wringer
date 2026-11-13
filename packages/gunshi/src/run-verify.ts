import {
  createNodePullRequestHost,
  createNodeRepoHost,
  createRepoState,
  makeProcessSupervisorPort,
  runSupervisorProcess,
} from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { getAgentProfile } from 'gunshi/agent';
import { buildLintedWringer } from './build-linted-wringer.ts';
import { readRepoRoot } from './read-repo-root.ts';
import { runCLI } from './run-cli.ts';

export interface VerifyOptions {
  // The folder of the repo's verify skill, relative to the repo root, which `lint` checks.
  readonly skill?: string | undefined;
}

const defaultSkillFolder = '.claude/skills/verify';

// The repo's verify script calls this with its registry. The script restarts itself as the run's
// supervisor, so the supervisor's command is the runtime and the script, without the user's
// arguments.
export async function runVerify(wringer: Wringer, options: VerifyOptions = {}): Promise<void> {
  const [, script] = process.argv;
  const selfCommand = script === undefined ? [process.execPath] : [process.execPath, script];

  process.exitCode = await runCLI(
    buildLintedWringer(wringer, options.skill ?? defaultSkillFolder),
    {
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
        repoHost: createNodeRepoHost(),
        pullRequests: createNodePullRequestHost(root),
        supervisor: makeProcessSupervisorPort({ selfCommand, root, stateDir: wringer.stateDir }),
      }),
      runSupervisor: runSupervisorProcess,
    },
  );
}
