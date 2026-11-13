import {
  createNodePullRequestHost,
  createNodeRepoHost,
  createRepoState,
  makeProcessSupervisorPort,
  runSupervisorProcess,
} from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { getAgentProfile } from 'gunshi/agent';
import { buildCLIWringer } from './build-cli-wringer.ts';
import { readRepoRoot } from './read-repo-root.ts';
import { runCLI } from './run-cli.ts';
import type { CLIPorts } from './run-cli.ts';

export interface VerifyOptions {
  // The folder of the repo's verify skill, relative to the repo root, which `lint` checks.
  readonly skill?: string | undefined;

  // The registry's own file, relative to the repo root, which `lint` checks for cover by a shared
  // glob or a feature's `paths`. It defaults to the script that runs the CLI.
  readonly registry?: string | undefined;
}

const defaultSkillFolder = '.claude/skills/verify';

// The repo's verify script calls this with its registry. The script restarts itself as the run's
// supervisor, so the supervisor's command is the runtime and the script, without the user's
// arguments.
export async function runVerify(wringer: Wringer, options: VerifyOptions = {}): Promise<void> {
  const [, script] = process.argv;

  await runWringer(
    buildCLIWringer(
      wringer,
      options.skill ?? defaultSkillFolder,
      options.registry ?? script ?? null,
    ),
  );
}

// Runs a registry as the process's CLI, with the process's arguments, streams and exit code.
export async function runWringer(
  wringer: Wringer,
  repoPorts?: Pick<CLIPorts, 'readRepoRoot' | 'openRepo'>,
): Promise<void> {
  const [, script] = process.argv;
  const selfCommand = script === undefined ? [process.execPath] : [process.execPath, script];

  process.exitCode = await runCLI(wringer, {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY,
    isAgent: getAgentProfile().isAgent,
    env: process.env,
    writeStdout: (text) => {
      process.stdout.write(text);
    },
    ...(repoPorts ?? {
      readRepoRoot,
      openRepo: (root: string) => ({
        state: createRepoState(root, wringer.stateDir),
        repoHost: createNodeRepoHost(),
        pullRequests: createNodePullRequestHost(root),
        supervisor: makeProcessSupervisorPort({ selfCommand, root, stateDir: wringer.stateDir }),
      }),
    }),
    runSupervisor: runSupervisorProcess,
  });
}
